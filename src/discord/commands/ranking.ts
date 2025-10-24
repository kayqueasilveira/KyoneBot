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

// --- Interfaces ---
interface UserRankData {
  discordId: string;
  discordTag: string;
  summonerName: string;
  totalGames: number;
  totalWins: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  winRate: number;
  kdaScore: number;
}

interface PlayerStatsWithRelations {
  win: boolean | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  LoL_Accounts: {
    owner_discord_id: string;
    summoner_name: string;
    Users: {
      discord_tag: string | null;
    } | null;
  } | null;
}
// --- FIM Interfaces ---

// --- Funções Auxiliares ---
function calculateNumericKDA(
  kills: number,
  deaths: number,
  assists: number
): number {
  if (deaths === 0) return kills + assists;
  return (kills + assists) / deaths;
}
// --- FIM Funções Auxiliares ---

const COMMAND_NAME = 'ranking';

createCommand({
  name: COMMAND_NAME,
  description: 'Mostra o ranking de jogadores por Taxa de Vitória ou KDA.',
  type: ApplicationCommandType.ChatInput,
  options: [
    {
      name: 'type',
      description: 'O tipo de ranking a ser exibido.',
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: '🏆 Taxa de Vitória (Winrate)', value: 'WINRATE' },
        { name: '⚔️ KDA (Kills+Assists / Deaths)', value: 'KDA' },
      ],
    },
  ],
  async run(interaction) {
    const rankingType = interaction.options.getString('type', true) as
      | 'WINRATE'
      | 'KDA';
    logger.info(
      COMMAND_NAME,
      `Comando iniciado por ${interaction.user.tag} para ranking do tipo ${rankingType}`
    );

    await interaction.deferReply();
    logger.info(COMMAND_NAME, 'Resposta adiada (deferReply).');

    const limit = 10;
    const minGames = 1;

    try {
      logger.db(
        COMMAND_NAME,
        'Buscando todas as estatísticas de jogadores vinculados...'
      );
      const { data: allStats, error: statsError } = await supabase
        .from('Player_Match_Stats')
        .select<string, PlayerStatsWithRelations>(
          `
          win, kills, deaths, assists,
          LoL_Accounts ( owner_discord_id, summoner_name, Users ( discord_tag ) ) 
          `
        )
        .not('LoL_Accounts', 'is', null)
        .not('LoL_Accounts.Users', 'is', null);

      if (statsError) {
        logger.error(
          COMMAND_NAME,
          'Erro ao buscar estatísticas globais.',
          statsError
        );
        throw new Error(`Erro ao buscar dados para o ranking.`);
      }
      logger.db(
        COMMAND_NAME,
        `Encontrados ${
          allStats?.length || 0
        } registros de estatísticas no total.`
      );

      if (!allStats || allStats.length === 0) {
        logger.warn(
          COMMAND_NAME,
          'Não há dados suficientes para gerar ranking.'
        );
        await interaction.editReply({
          content: 'Não há dados suficientes para gerar um ranking ainda.',
        });
        return;
      }

      logger.process(
        COMMAND_NAME,
        'Agregando estatísticas por usuário Discord...'
      );
      const userStatsMap = new Map<string, UserRankData>();
      for (const stat of allStats) {
        const lolAccount = stat.LoL_Accounts;
        const discordUser = lolAccount?.Users;
        if (!lolAccount || !discordUser) continue;

        const discordId = lolAccount.owner_discord_id;
        const discordTag =
          discordUser.discord_tag || `Usuário (${discordId.slice(0, 6)}...)`;
        const summonerName = lolAccount.summoner_name;

        let userData = userStatsMap.get(discordId);
        if (!userData) {
          userData = {
            discordId: discordId,
            discordTag: discordTag,
            summonerName: summonerName,
            totalGames: 0,
            totalWins: 0,
            totalKills: 0,
            totalDeaths: 0,
            totalAssists: 0,
            winRate: 0,
            kdaScore: 0,
          };
          userStatsMap.set(discordId, userData);
        }
        if (summonerName && userData.summonerName !== summonerName) {
          userData.summonerName = summonerName;
        }

        if (
          discordUser.discord_tag &&
          userData.discordTag !== discordUser.discord_tag
        ) {
          userData.discordTag = discordUser.discord_tag;
        }

        userData.totalGames++;
        if (stat.win === true) userData.totalWins++;
        userData.totalKills += stat.kills ?? 0;
        userData.totalDeaths += stat.deaths ?? 0;
        userData.totalAssists += stat.assists ?? 0;
      }
      logger.success(
        COMMAND_NAME,
        `Estatísticas agregadas para ${userStatsMap.size} usuários.`
      );

      logger.process(
        COMMAND_NAME,
        `Calculando ${
          rankingType === 'WINRATE' ? 'Winrate' : 'KDA'
        } e filtrando por ${minGames} jogos...`
      );
      const rankedUsers: UserRankData[] = [];
      for (const userData of userStatsMap.values()) {
        userData.winRate =
          userData.totalGames > 0
            ? userData.totalWins / userData.totalGames
            : 0;
        userData.kdaScore = calculateNumericKDA(
          userData.totalKills,
          userData.totalDeaths,
          userData.totalAssists
        );
        rankedUsers.push(userData);
      }
      const filteredUsers = rankedUsers.filter((u) => u.totalGames >= minGames);
      logger.info(
        COMMAND_NAME,
        `${filteredUsers.length} usuários qualificados (>= ${minGames} jogos).`
      );

      if (filteredUsers.length === 0) {
        logger.warn(COMMAND_NAME, `Nenhum jogador qualificado encontrado.`);
        await interaction.editReply({
          content: `Nenhum jogador com ${minGames} ou mais partidas encontradas para gerar o ranking.`,
        });
        return;
      }

      logger.process(COMMAND_NAME, `Ordenando ranking por ${rankingType}...`);
      if (rankingType === 'WINRATE') {
        filteredUsers.sort(
          (a, b) =>
            b.winRate - a.winRate ||
            b.kdaScore - a.kdaScore ||
            b.totalGames - a.totalGames
        );
      } else {
        // KDA
        filteredUsers.sort(
          (a, b) =>
            b.kdaScore - a.kdaScore ||
            b.winRate - a.winRate ||
            b.totalGames - a.totalGames
        );
      }

      const topUsers = filteredUsers.slice(0, limit);
      logger.process(
        COMMAND_NAME,
        `Formatando descrição do ranking para top ${topUsers.length}...`
      );
      let rankDescription = '';
      topUsers.forEach((user, index) => {
        const rank = index + 1;
        const medal =
          rank === 1
            ? '🥇'
            : rank === 2
            ? '🥈'
            : rank === 3
            ? '🥉'
            : `${rank}.`;
        const winRateFormatted = `${(user.winRate * 100).toFixed(1)}%`;
        const kdaFormatted = user.kdaScore.toFixed(2);
        const userDisplay = user.summonerName
          ? `**${user.summonerName}**`
          : user.discordTag !== `Usuário (${user.discordId.slice(0, 6)}...)`
          ? `**${user.discordTag}**`
          : `<@${user.discordId}>`;

        rankDescription += `${medal} ${userDisplay}\n`;
        if (rankingType === 'WINRATE') {
          rankDescription += `   └── 🏆 WR: **${winRateFormatted}** (${
            user.totalWins
          }V/${user.totalGames - user.totalWins}D) | KDA: ${kdaFormatted}\n`;
        } else {
          // KDA
          rankDescription += `   └── ⚔️ KDA: **${kdaFormatted}** (${user.totalKills}/${user.totalDeaths}/${user.totalAssists}) | WR: ${winRateFormatted}\n`;
        }
      });

      if (!rankDescription) {
        logger.warn(
          COMMAND_NAME,
          'Descrição do ranking vazia após formatação.'
        );
        rankDescription = 'Nenhum jogador qualificado para este ranking.';
      }
      logger.success(COMMAND_NAME, 'Ranking gerado e formatado.');

      const embed = new EmbedBuilder()
        .setColor(rankingType === 'WINRATE' ? '#FEE75C' : '#ED4245')
        .setTitle(
          `🎖️ Ranking de Jogadores - Top ${topUsers.length} por ${
            rankingType === 'WINRATE' ? 'Taxa de Vitória' : 'KDA'
          }`
        )
        .setDescription(rankDescription || 'Nenhum dado para exibir.')
        .setFooter({
          text: `Mínimo de ${minGames} partidas para qualificar. Total de ${filteredUsers.length} jogadores qualificados.`,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      logger.info(
        COMMAND_NAME,
        `Ranking tipo ${rankingType} enviado com sucesso.`
      );
    } catch (error: any) {
      logger.error(COMMAND_NAME, 'Erro ao gerar ranking:', error);
      const errorOptions: InteractionEditReplyOptions = {
        content: `❌ Ocorreu um erro ao gerar o ranking: ${
          error.message || 'Erro desconhecido.'
        }`,
        embeds: [],
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply(errorOptions);
        } else {
          await interaction.reply({
            ...errorOptions,
            ephemeral: true,
          } as InteractionReplyOptions);
        }
      } catch (replyError: any) {
        logger.error(
          COMMAND_NAME,
          'Falha ao enviar/editar resposta de erro final.',
          replyError
        );
      }
    }
  },
});
