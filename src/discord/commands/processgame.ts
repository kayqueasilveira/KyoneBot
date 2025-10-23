import { createCommand } from '#base';
import { supabase } from '#database';
import { logger } from '#functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Channel,
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  NewsChannel,
  TextChannel,
  ThreadChannel,
} from 'discord.js';

// --- Definições de Tipos ---
interface PlayerData {
  summonerName: string | null;
  championName: string | null;
  KDA: string | null;
  damage: number | null;
  gold: number | null;
}

interface GameData {
  result: 'VICTORY' | 'DEFEAT' | null | 'UNKNOWN';
  team1_players: PlayerData[] | null;
  team2_players: PlayerData[] | null;
}

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
// --- FIM Definições de Tipos ---

// --- CONFIGURAÇÃO GEMINI E PROMPT ---
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  logger.error(
    'System',
    'A variável de ambiente GEMINI_API_KEY não está definida.'
  );
}
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
if (genAI) {
  logger.system('GeminiAI', 'Cliente inicializado.');
} else {
  logger.system('GeminiAI', 'Falha ao inicializar (API Key ausente).', false);
}
const finalPrompt = `
Sua tarefa é analisar a imagem de um placar de pós-jogo do League of Legends e extrair os dados de todos os 10 jogadores. Você deve retornar estritamente um único objeto JSON válido, sem nenhum texto, comentário ou formatação markdown como \`\`\`json antes ou depois.
A estrutura do JSON deve ser exatamente esta:
{
  "result": "VICTORY" or "DEFEAT",
  "team1_players": [{"summonerName": "...", "championName": "...", "KDA": "K/D/A", "damage": 0, "gold": 0}],
  "team2_players": [{"summonerName": "...", "championName": "...", "KDA": "K/D/A", "damage": 0, "gold": 0}]
}
Siga estas regras de extração com precisão absoluta:
1.  **result**: Encontre a palavra "VICTORY" ou "DEFEAT" no canto superior esquerdo.
2.  **team1_players / team2_players**: Extraia os 5 jogadores de cada time para as listas correspondentes.
3.  **summonerName**: O nome de invocador de cada jogador.
4.  **championName**: O nome do campeão, localizado abaixo do summonerName.
5.  **KDA**: O trio de números no formato "K / D / A".
6.  **damage**: É o primeiro dos dois grandes números à direita do KDA. Extraia apenas o número inteiro.
7.  **gold**: É o segundo dos dois grandes números, à direita do dano. Extraia apenas o número inteiro.
Seja meticuloso. Não invente dados. Se um dado for ilegível, use um valor nulo (null).
`;

const COMMAND_NAME = 'processgame';

async function getLogChannelId(guildId: string | null): Promise<string | null> {
  if (!guildId) return null;
  try {
    const { data, error } = await supabase
      .from('Guild_Settings')
      .select('log_channel_id')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) {
      logger.error(
        COMMAND_NAME,
        `Erro ao buscar canal de log para guild ${guildId}`,
        error
      );
      return null;
    }
    return data?.log_channel_id ?? null;
  } catch (dbError: any) {
    logger.error(
      COMMAND_NAME,
      `Exceção ao buscar canal de log para guild ${guildId}`,
      dbError
    );
    return null;
  }
}

createCommand({
  name: COMMAND_NAME,
  description: 'Extrai e salva os dados de um screenshot de partida do LoL.',
  type: ApplicationCommandType.ChatInput,
  options: [
    {
      name: 'screenshot',
      description: 'O screenshot do placar final da partida.',
      type: ApplicationCommandOptionType.Attachment,
      required: true,
    },
  ],
  async run(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      logger.warn(
        COMMAND_NAME,
        `Comando executado fora de um servidor por ${
          interaction.user?.tag || 'usuário desconhecido'
        }.`
      );
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'Este comando só pode ser usado dentro de um servidor.',
            ephemeral: true,
          });
        } else if (!interaction.replied) {
          await interaction.followUp({
            content: 'Este comando só pode ser usado dentro de um servidor.',
            ephemeral: true,
          });
        }
      } catch (replyError: any) {
        logger.error(
          COMMAND_NAME,
          'Falha ao enviar resposta de erro inGuild.',
          replyError
        );
      }
      return;
    }
    const currentGuildId = interaction.guildId;

    logger.info(
      COMMAND_NAME,
      `Comando iniciado por ${interaction.user.tag} (${interaction.user.id}) no servidor ${currentGuildId}`
    );

    if (!genAI) {
      logger.error(
        COMMAND_NAME,
        'Tentativa de execução sem cliente GeminiAI inicializado.'
      );
      const errorOptions: InteractionReplyOptions = {
        content:
          'Erro interno: A configuração da API do Gemini não está carregada. Contate o administrador.',
        ephemeral: true,
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply(
            errorOptions as InteractionEditReplyOptions
          );
        } else {
          await interaction.reply(errorOptions);
        }
      } catch (replyError: any) {
        logger.error(
          COMMAND_NAME,
          'Falha ao enviar/editar resposta de erro Gemini.',
          replyError
        );
      }
      return;
    }

    let deferredSuccessfully = false;
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.deferReply();
        logger.info(COMMAND_NAME, 'Resposta adiada (deferReply).');
        deferredSuccessfully = true;
      } catch (deferError: any) {
        logger.error(
          COMMAND_NAME,
          'Falha ao adiar resposta (deferReply).',
          deferError
        );
        try {
          if (!interaction.replied) {
            await interaction.reply({
              content:
                'Ocorreu um erro ao iniciar o processamento. Tente novamente.',
              ephemeral: true,
            });
          }
        } catch (replyError: any) {
          logger.error(
            COMMAND_NAME,
            'Falha ao enviar resposta de erro inicial após falha no defer.',
            replyError
          );
        }
        return;
      }
    } else if (interaction.deferred) {
      deferredSuccessfully = true;
      logger.info(COMMAND_NAME, 'Resposta já estava adiada.');
    } else {
      logger.warn(
        COMMAND_NAME,
        'Interação já respondida antes do fluxo principal.'
      );
      return;
    }

    if (!deferredSuccessfully) {
      logger.error(
        COMMAND_NAME,
        'Não foi possível adiar a resposta, cancelando execução.'
      );
      return;
    }

    let savedMatchHash: string | null = null;

    try {
      const attachment = interaction.options.getAttachment('screenshot', true);
      logger.info(
        COMMAND_NAME,
        `Anexo recebido: ${attachment.name} (${attachment.contentType})`
      );

      if (!attachment?.contentType?.startsWith('image/')) {
        logger.warn(COMMAND_NAME, 'Tipo de anexo inválido recebido.');
        await interaction.editReply({
          content: 'Por favor, envie um arquivo de imagem válido.',
        });
        return;
      }

      logger.api(COMMAND_NAME, 'Enviando imagem para análise do Gemini...');
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const imageBuffer = Buffer.from(
        await (await fetch(attachment.url)).arrayBuffer()
      );
      const imagePart = {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: attachment.contentType,
        },
      };
      const result = await model.generateContent([finalPrompt, imagePart]);
      const responseText = result.response.text();
      logger.api(COMMAND_NAME, 'Resposta recebida do Gemini.');

      let rawData: GameData;
      try {
        const cleanedText = responseText.replace(/^```json\s*|```\s*$/g, '');
        rawData = JSON.parse(cleanedText) as GameData;
        logger.success(COMMAND_NAME, 'JSON da IA parseado com sucesso.');
      } catch (parseError: any) {
        logger.error(
          COMMAND_NAME,
          'Falha ao parsear JSON da IA.',
          parseError,
          `Texto Recebido: ${responseText.substring(0, 200)}...`
        );
        throw new Error('A IA não retornou um formato de dados válido.');
      }

      logger.process(
        COMMAND_NAME,
        'Iniciando processamento e validação dos dados...'
      );
      const allPlayersRaw: PlayerData[] = [
        ...(rawData.team1_players || []),
        ...(rawData.team2_players || []),
      ];
      if (allPlayersRaw.length < 10) {
        logger.warn(
          COMMAND_NAME,
          `IA retornou ${allPlayersRaw.length} jogadores, esperado 10.`
        );
        throw new Error(
          `A análise da imagem falhou em extrair todos os 10 jogadores (extraiu ${allPlayersRaw.length}).`
        );
      }
      allPlayersRaw.sort((a: PlayerData, b: PlayerData) =>
        (a.summonerName || '').localeCompare(b.summonerName || '')
      );
      const canonicalString = allPlayersRaw
        .map((p: PlayerData) => `${p.summonerName}:${p.KDA}`)
        .join(';');
      const matchHash = crypto
        .createHash('sha256')
        .update(canonicalString)
        .digest('hex');
      logger.process(
        COMMAND_NAME,
        `Hash da partida gerado: ${matchHash.slice(0, 12)}...`
      );

      logger.db(
        COMMAND_NAME,
        `Verificando duplicidade do hash ${matchHash.slice(0, 12)}...`
      );
      const { data: existingMatch, error: checkError } = await supabase
        .from('Matches')
        .select('match_hash')
        .eq('match_hash', matchHash)
        .maybeSingle();
      if (checkError) {
        logger.error(
          COMMAND_NAME,
          `Erro ao verificar duplicidade do hash ${matchHash.slice(0, 12)}...`,
          checkError
        );
        throw new Error('Erro ao verificar se a partida já existe.');
      }
      if (existingMatch) {
        logger.warn(
          COMMAND_NAME,
          `Partida duplicada encontrada (Hash: ${matchHash.slice(0, 12)}...).`
        );
        await interaction.editReply({
          content: '**Erro:** Esta partida já foi registrada.',
        });
        return;
      }

      logger.db(
        COMMAND_NAME,
        `Partida nova (${matchHash.slice(0, 12)}...). Salvando...`
      );
      const resultText = rawData.result || 'UNKNOWN';
      const winningTeam =
        resultText === 'VICTORY' ? 1 : resultText === 'DEFEAT' ? 2 : null;
      if (winningTeam === null) {
        logger.warn(COMMAND_NAME, 'Resultado (VICTORY/DEFEAT) não encontrado.');
      }

      const { error: matchInsertError } = await supabase
        .from('Matches')
        .insert({
          match_hash: matchHash,
          winning_team: winningTeam,
          processed_at: new Date().toISOString(),
          screenshot_url: attachment.url,
        });
      if (matchInsertError) {
        logger.error(
          COMMAND_NAME,
          'Falha ao inserir na tabela Matches.',
          matchInsertError
        );
        throw new Error(`Falha ao salvar info básica da partida.`);
      }
      logger.db(
        COMMAND_NAME,
        `Partida ${matchHash.slice(0, 12)}... inserida na tabela Matches.`
      );
      savedMatchHash = matchHash;

      const summonerNames = allPlayersRaw
        .map((p: PlayerData) => p.summonerName)
        .filter(Boolean);
      if (summonerNames.length === 0) {
        logger.error(
          COMMAND_NAME,
          'Nenhum nome de invocador válido extraído da IA.'
        );
        logger.db(
          COMMAND_NAME,
          `Rollback: Deletando partida ${matchHash.slice(
            0,
            12
          )}... da Matches por falta de nomes.`
        );
        const { error: deleteError } = await supabase
          .from('Matches')
          .delete()
          .eq('match_hash', matchHash);
        if (deleteError)
          logger.error(COMMAND_NAME, 'Falha ao fazer rollback!', deleteError);
        throw new Error('Não foi possível extrair nomes de invocador válidos.');
      }

      logger.db(COMMAND_NAME, `Buscando ${summonerNames.length} contas LoL...`);
      const { data: accounts, error: accountFetchError } = await supabase
        .from('LoL_Accounts')
        .select<string, LoLAccount>('account_id, summoner_name')
        .in('summoner_name', summonerNames);
      if (accountFetchError) {
        logger.error(
          COMMAND_NAME,
          'Falha ao buscar contas LoL.',
          accountFetchError
        );
        logger.db(
          COMMAND_NAME,
          `Rollback: Deletando partida ${matchHash.slice(
            0,
            12
          )}... da Matches por falha na busca de contas.`
        );
        const { error: deleteError } = await supabase
          .from('Matches')
          .delete()
          .eq('match_hash', matchHash);
        if (deleteError)
          logger.error(COMMAND_NAME, 'Falha ao fazer rollback!', deleteError);
        throw new Error(`Falha ao buscar contas LoL.`);
      }
      logger.db(
        COMMAND_NAME,
        `Encontradas ${accounts?.length || 0} contas LoL.`
      );

      const accountMap = new Map<string, string>(
        accounts?.map((acc: LoLAccount) => [
          acc.summoner_name,
          acc.account_id,
        ]) || []
      );
      const statsToInsert: PlayerStatsInsert[] = allPlayersRaw.map(
        (player: PlayerData): PlayerStatsInsert => {
          const kdaParts = (player.KDA || '0/0/0').split('/');
          const kills = parseInt(kdaParts[0]?.trim()) || 0;
          const deaths = parseInt(kdaParts[1]?.trim()) || 0;
          const assists = parseInt(kdaParts[2]?.trim()) || 0;
          const team = (rawData.team1_players || []).some(
            (p: PlayerData) => p.summonerName === player.summonerName
          )
            ? 1
            : 2;
          return {
            match_hash: matchHash,
            account_id: accountMap.get(player.summonerName || '') || null,
            summoner_name_snapshot: player.summonerName || 'Desconhecido',
            champion_name: player.championName || 'Desconhecido',
            win: winningTeam !== null ? team === winningTeam : null,
            team: team,
            kills: kills,
            deaths: deaths,
            assists: assists,
            damage: player.damage || 0,
            gold: player.gold || 0,
          };
        }
      );

      logger.db(
        COMMAND_NAME,
        `Inserindo ${statsToInsert.length} stats para ${matchHash.slice(
          0,
          12
        )}...`
      );
      const { error: statsInsertError } = await supabase
        .from('Player_Match_Stats')
        .insert(statsToInsert);
      if (statsInsertError) {
        logger.error(
          COMMAND_NAME,
          `Falha ao inserir estatísticas para ${matchHash.slice(0, 12)}.`,
          statsInsertError
        );
        logger.db(
          COMMAND_NAME,
          `Rollback: Deletando partida ${matchHash.slice(0, 12)}... da Matches.`
        );
        const { error: deleteError } = await supabase
          .from('Matches')
          .delete()
          .eq('match_hash', matchHash);
        if (deleteError) {
          logger.error(
            COMMAND_NAME,
            `Falha crítica no rollback! Hash: ${matchHash.slice(0, 12)}`,
            deleteError
          );
        }
        throw new Error(`Falha ao salvar as estatísticas detalhadas.`);
      }

      logger.success(
        COMMAND_NAME,
        `Dados da partida ${matchHash.slice(0, 12)}... salvos com sucesso.`
      );

      const registeredPlayers = statsToInsert.filter(
        (s) => s.account_id !== null
      ).length;
      const successEmbed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('✅ Partida Registrada com Sucesso!')
        .setDescription(
          `A partida com ID \`${matchHash.slice(
            0,
            12
          )}\` foi analisada e salva.`
        )
        .addFields({
          name: 'Jogadores Vinculados',
          value: `${registeredPlayers} de 10 jogadores vinculados a contas.`,
        })
        .setTimestamp();
      await interaction.editReply({ embeds: [successEmbed] });
      logger.info(COMMAND_NAME, 'Resposta de sucesso enviada ao usuário.');

      // ENVIO PARA O CANAL DE LOGS
      const logChannelId = await getLogChannelId(currentGuildId);
      if (logChannelId) {
        try {
          const channel: Channel | null =
            await interaction.client.channels.fetch(logChannelId);

          if (
            channel instanceof TextChannel ||
            channel instanceof NewsChannel ||
            channel instanceof ThreadChannel
          ) {
            logger.info(
              COMMAND_NAME,
              `Enviando log para o canal ${logChannelId}...`
            );
            const affectedSummoners =
              statsToInsert
                .filter((s) => s.account_id !== null)
                .map((s) => `\`${s.summoner_name_snapshot}\``)
                .join(', ') || 'Nenhum';
            const logEmbed = new EmbedBuilder()
              .setColor('#2ECC71')
              .setTitle('📄 Nova Partida Processada')
              .setDescription(
                `Partida submetida por ${interaction.user} (${interaction.user.tag})`
              )
              .addFields(
                { name: 'Hash', value: `\`${matchHash}\``, inline: true },
                {
                  name: 'Horário',
                  value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                  inline: true,
                },
                {
                  name: 'Jogadores Afetados',
                  value: affectedSummoners,
                  inline: false,
                }
              )
              .setImage(attachment.url)
              .setTimestamp();
            await channel.send({ embeds: [logEmbed] });
            logger.success(
              COMMAND_NAME,
              `Log enviado com sucesso para o canal ${logChannelId}.`
            );
          } else {
            logger.warn(
              COMMAND_NAME,
              `Canal de log ${logChannelId} não encontrado ou não é um canal de texto/notícia/thread válido.`
            );
          }
        } catch (logError: any) {
          logger.error(
            COMMAND_NAME,
            `Falha ao buscar ou enviar para o canal de log ${logChannelId}.`,
            logError
          );
        }
      } else {
        logger.warn(
          COMMAND_NAME,
          `Nenhum canal de log configurado para o servidor ${currentGuildId}.`
        );
      }
    } catch (error: any) {
      logger.error(
        COMMAND_NAME,
        'Erro crítico durante o processamento:',
        error
      );

      if (
        savedMatchHash &&
        !error.message.includes('estatísticas detalhadas')
      ) {
        logger.db(
          COMMAND_NAME,
          `Rollback CRÍTICO: Deletando partida ${savedMatchHash.slice(
            0,
            12
          )}... devido a erro posterior.`
        );
        const { error: deleteError } = await supabase
          .from('Matches')
          .delete()
          .eq('match_hash', savedMatchHash);
        if (deleteError) {
          logger.error(
            COMMAND_NAME,
            `Falha crítica no rollback da partida ${savedMatchHash.slice(
              0,
              12
            )}!`,
            deleteError
          );
        }
      }

      const errorOptions: InteractionEditReplyOptions = {
        content: `❌ Ocorreu um erro: ${
          error.message || 'Erro desconhecido.'
        }. Se o problema persistir, contate um administrador.`,
        embeds: [],
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply(errorOptions);
        } else {
          logger.warn(
            COMMAND_NAME,
            'Tentando responder erro sem defer prévio.'
          );
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
