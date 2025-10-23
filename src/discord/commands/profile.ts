import { createCommand } from '#base';
import { supabase } from '#database';
import { logger } from '#functions';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  EmbedBuilder,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from 'discord.js';

// --- Funções Auxiliares ---
function calculateNumericKDA(
  kills: number,
  deaths: number,
  assists: number
): number {
  if (deaths === 0) return kills + assists;
  return (kills + assists) / deaths;
}
function formatKDA(kills: number, deaths: number, assists: number): string {
  const score = calculateNumericKDA(kills, deaths, assists);
  if (deaths === 0) return `${score.toFixed(1)} KDA (Perfeito)`;
  return score.toFixed(2);
}
function calculateWinRate(wins: number, totalGames: number): string {
  if (totalGames === 0) return 'N/A (0%)';
  return `${((wins / totalGames) * 100).toFixed(1)}%`;
}
// --- FIM Funções Auxiliares ---

// --- Definições de Tipos ---
interface LoLAccount {
  account_id: string;
  summoner_name: string;
}
interface PlayerStatsBasic {
  win: boolean | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damage: number | null;
  gold: number | null;
}
// --- FIM Definições de Tipos ---

const COMMAND_NAME = 'profile';

createCommand({
  name: COMMAND_NAME,
  description: 'Mostra o perfil e estatísticas de LoL de um usuário.',
  type: ApplicationCommandType.ChatInput,
  options: [
    {
      name: 'user',
      description:
        'O usuário do Discord para ver o perfil (opcional, padrão: você mesmo).',
      type: ApplicationCommandOptionType.User,
      required: false,
    },
  ],
  async run(interaction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    logger.info(
      COMMAND_NAME,
      `Comando iniciado por ${interaction.user.tag} para o perfil de ${targetUser.tag}`
    );

    await interaction.deferReply();
    logger.info(COMMAND_NAME, 'Resposta adiada (deferReply).');

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
        `Buscando estatísticas para o summoner_name_snapshot: ${linkedSummonerName}`
      );
      const { data: stats, error: statsError } = await supabase
        .from('Player_Match_Stats')
        .select<string, PlayerStatsBasic>(
          'win, kills, deaths, assists, damage, gold'
        )
        .eq('summoner_name_snapshot', linkedSummonerName); // Busca todas as partidas com esse nome

      if (statsError) {
        logger.error(
          COMMAND_NAME,
          `Erro ao buscar estatísticas para ${linkedSummonerName}.`,
          statsError
        );
        throw new Error(
          `Não foi possível buscar as estatísticas das partidas.`
        );
      }
      logger.db(
        COMMAND_NAME,
        `Encontrados ${
          stats?.length || 0
        } registros de estatísticas para ${linkedSummonerName}.`
      );

      logger.process(
        COMMAND_NAME,
        `Calculando estatísticas agregadas para ${linkedSummonerName}...`
      );
      let totalGames = 0;
      let totalWins = 0;
      let totalKills = 0;
      let totalDeaths = 0;
      let totalAssists = 0;
      let totalDamage = 0;
      let totalGold = 0;

      if (stats && stats.length > 0) {
        totalGames = stats.length;
        stats.forEach((s) => {
          if (s.win === true) totalWins++;
          totalKills += s.kills ?? 0;
          totalDeaths += s.deaths ?? 0;
          totalAssists += s.assists ?? 0;
          totalDamage += s.damage ?? 0;
          totalGold += s.gold ?? 0;
        });
      }

      const kdaFormatted = formatKDA(totalKills, totalDeaths, totalAssists);
      const winRateFormatted = calculateWinRate(totalWins, totalGames);
      const avgDamage =
        totalGames > 0
          ? (totalDamage / totalGames).toLocaleString('pt-BR', {
              maximumFractionDigits: 0,
            })
          : '0';
      const avgGold =
        totalGames > 0
          ? (totalGold / totalGames).toLocaleString('pt-BR', {
              maximumFractionDigits: 0,
            })
          : '0';
      logger.success(
        COMMAND_NAME,
        `Estatísticas agregadas calculadas para ${linkedSummonerName}. Jogos: ${totalGames}`
      );

      const embed = new EmbedBuilder()
        .setColor('#3b82f6')
        .setAuthor({
          name: `Perfil de ${targetUser.username} | Conta: ${linkedSummonerName}`,
          iconURL: targetUser.displayAvatarURL(),
        })
        .setTitle('Estatísticas Gerais - League of Legends')
        .setDescription(
          `Exibindo dados de todas as partidas registradas para \`${linkedSummonerName}\`.`
        )
        .addFields(
          {
            name: '📊 Partidas Registradas',
            value: totalGames.toString(),
            inline: true,
          },
          { name: '🏆 Vitórias', value: totalWins.toString(), inline: true },
          { name: '📈 Taxa de Vitória', value: winRateFormatted, inline: true },
          { name: '⚔️ KDA Médio', value: kdaFormatted, inline: true },
          { name: '💥 Dano Médio', value: avgDamage, inline: true },
          { name: '💰 Ouro Médio', value: avgGold, inline: true },
          {
            name: '🎯 Abates Totais',
            value: totalKills.toLocaleString('pt-BR'),
            inline: true,
          },
          {
            name: '💀 Mortes Totais',
            value: totalDeaths.toLocaleString('pt-BR'),
            inline: true,
          },
          {
            name: '🤝 Assist. Totais',
            value: totalAssists.toLocaleString('pt-BR'),
            inline: true,
          }
        )
        .setTimestamp()
        .setFooter({ text: `Usuário Discord: ${targetUser.tag}` });

      await interaction.editReply({ embeds: [embed] });
      logger.info(
        COMMAND_NAME,
        `Perfil de ${targetUser.tag} (${linkedSummonerName}) enviado com sucesso.`
      );
    } catch (error: any) {
      logger.error(
        COMMAND_NAME,
        `Erro ao processar perfil para ${targetUser.tag}:`,
        error
      );
      const errorOptions: InteractionEditReplyOptions = {
        content: `❌ Ocorreu um erro ao buscar o perfil: ${
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
