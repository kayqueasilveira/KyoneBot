import { createCommand } from '#base';
import { supabase } from '#database';
import { logger } from '#functions';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  EmbedBuilder,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from 'discord.js';

// --- Definições de Tipos ---
interface LoLAccount {
  account_id: string;
  summoner_name: string;
}
interface PlayerStatsInsert {
  match_hash: string;
  account_id: string | null;
  summoner_name_snapshot: string;
  champion_name: string;
  win: boolean | null;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  gold: number;
}
interface PlayerStatsWithMatchDate extends PlayerStatsInsert {
  Matches: {
    processed_at: string | null;
  } | null;
}
// --- FIM Definições de Tipos ---

const COMMAND_NAME = 'history';

createCommand({
  name: COMMAND_NAME,
  description: 'Mostra o histórico de partidas recentes de um usuário.',
  type: ApplicationCommandType.ChatInput,
  options: [
    {
      name: 'user',
      description:
        'O usuário do Discord para ver o histórico (opcional, padrão: você mesmo).',
      type: ApplicationCommandOptionType.User,
      required: false,
    },
  ],
  async run(interaction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    logger.info(
      COMMAND_NAME,
      `Comando iniciado por ${interaction.user.tag} para o histórico de ${targetUser.tag}`
    );

    await interaction.deferReply();
    logger.info(COMMAND_NAME, 'Resposta adiada (deferReply).');

    const limit = 10;

    try {
      logger.db(
        COMMAND_NAME,
        `Buscando conta LoL vinculada para ${targetUser.tag} (${targetUser.id})...`
      );
      // Busca a ÚNICA conta vinculada
      const { data: lolAccount, error: accountError } = await supabase
        .from('LoL_Accounts')
        .select<string, LoLAccount>('account_id, summoner_name')
        .eq('owner_discord_id', targetUser.id)
        .maybeSingle();

      if (accountError) {
        logger.error(
          COMMAND_NAME,
          `Erro ao buscar conta LoL para ${targetUser.tag}.`,
          accountError
        );
        throw new Error(`Não foi possível buscar a conta LoL vinculada.`);
      }

      if (!lolAccount) {
        logger.warn(
          COMMAND_NAME,
          `Nenhuma conta LoL encontrada para ${targetUser.tag}.`
        );
        await interaction.editReply({
          content: `${targetUser.username} não possui conta LoL registrada. Use \`/register\`.`,
        });
        return;
      }
      const linkedSummonerName = lolAccount.summoner_name;
      logger.db(
        COMMAND_NAME,
        `Conta encontrada para ${targetUser.tag}: ${linkedSummonerName}`
      );

      logger.db(
        COMMAND_NAME,
        `Buscando últimas ${limit} partidas para o summoner_name_snapshot: ${linkedSummonerName}`
      );
      const dateColumn = 'processed_at';
      const { data: recentStats, error: statsError } = await supabase
        .from('Player_Match_Stats')
        .select<string, PlayerStatsWithMatchDate>(
          `*, Matches ( ${dateColumn} )`
        )
        .eq('summoner_name_snapshot', linkedSummonerName) // Busca todas as partidas com esse nome
        .order(dateColumn, { referencedTable: 'Matches', ascending: false }) // Ordena
        .limit(limit);

      if (statsError) {
        logger.error(
          COMMAND_NAME,
          `Erro ao buscar histórico para ${linkedSummonerName}.`,
          statsError
        );
        throw new Error(`Não foi possível buscar o histórico de partidas.`);
      }
      logger.db(
        COMMAND_NAME,
        `Encontrados ${
          recentStats?.length || 0
        } registros de histórico para ${linkedSummonerName}.`
      );

      if (!recentStats || recentStats.length === 0) {
        logger.warn(
          COMMAND_NAME,
          `Nenhum histórico encontrado para ${linkedSummonerName}.`
        );
        await interaction.editReply({
          content: `Nenhum histórico de partida encontrado para \`${linkedSummonerName}\`.`,
        });
        return;
      }

      logger.process(COMMAND_NAME, 'Formatando dados do histórico...');
      const historyFields = recentStats.map((stat) => {
        const kda = `${stat.kills ?? '?'}/${stat.deaths ?? '?'}/${
          stat.assists ?? '?'
        }`;
        const result =
          stat.win === null ? '??' : stat.win ? 'Vitória' : 'Derrota';
        const matchDateRaw =
          stat.Matches?.[dateColumn as keyof typeof stat.Matches];
        const matchDate = matchDateRaw ? new Date(matchDateRaw) : null;
        const timeAgo = matchDate
          ? formatDistanceToNow(matchDate, { addSuffix: true, locale: ptBR })
          : 'Data desconhecida';
        const damageFormatted = stat.damage?.toLocaleString('pt-BR') ?? '?';
        const goldFormatted = stat.gold?.toLocaleString('pt-BR') ?? '?';

        return {
          name: `${stat.champion_name || '?'} (${result}) - ${timeAgo}`,
          value: `KDA: ${kda} | Dano: ${damageFormatted} | Ouro: ${goldFormatted}\n*Hash: \`${stat.match_hash.slice(
            0,
            8
          )}...\`*`,
          inline: false,
        };
      });
      logger.success(COMMAND_NAME, 'Dados do histórico formatados.');

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setAuthor({
          name: `Histórico de Partidas de ${targetUser.username} | Conta: ${linkedSummonerName}`,
          iconURL: targetUser.displayAvatarURL(),
        })
        .setDescription(
          `Exibindo as últimas ${recentStats.length} partidas registradas para \`${linkedSummonerName}\`.`
        )
        .addFields(historyFields)
        .setTimestamp()
        .setFooter({
          text: `Mostrando ${recentStats.length} de até ${limit} partidas.`,
        });

      await interaction.editReply({ embeds: [embed] });
      logger.info(
        COMMAND_NAME,
        `Histórico de ${targetUser.tag} (${linkedSummonerName}) enviado com sucesso.`
      );
    } catch (error: any) {
      logger.error(
        COMMAND_NAME,
        `Erro ao processar histórico para ${targetUser.tag}:`,
        error
      );
      const errorOptions: InteractionEditReplyOptions = {
        content: `❌ Ocorreu um erro ao buscar o histórico: ${
          error.message || 'Erro desconhecido.'
        }`,
        embeds: [],
      };
      if (interaction.deferred || interaction.replied) {
        await interaction
          .editReply(errorOptions)
          .catch((e) =>
            logger.error(COMMAND_NAME, 'Falha ao editar resposta de erro.', e)
          );
      } else {
        await interaction
          .reply({
            ...errorOptions,
            ephemeral: true,
          } as InteractionReplyOptions)
          .catch((e) =>
            logger.error(
              COMMAND_NAME,
              'Falha ao enviar resposta de erro inicial.',
              e
            )
          );
      }
    }
  },
});
