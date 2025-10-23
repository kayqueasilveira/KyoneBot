import { createCommand } from '#base';
import { supabase } from '#database';
import { logger } from '#functions';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  EmbedBuilder,
} from 'discord.js';

const COMMAND_NAME = 'register';

createCommand({
  name: COMMAND_NAME,
  description: 'Vincula sua conta League of Legends ao seu Discord (máx 1).',
  type: ApplicationCommandType.ChatInput,
  options: [
    {
      name: 'nickname',
      description: 'Seu nome de invocador no LoL (Ex: Jogador Exemplo).',
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
  async run(interaction) {
    const summonerName = interaction.options.getString('nickname', true).trim();
    const { id: discord_id, tag: discord_tag } = interaction.user;
    logger.info(
      COMMAND_NAME,
      `Comando iniciado por ${discord_tag} (${discord_id}) para registrar '${summonerName}'`
    );

    await interaction.deferReply({ ephemeral: true });
    logger.info(COMMAND_NAME, 'Resposta adiada (deferReply) ephemeral.');

    try {
      if (
        !summonerName ||
        summonerName.length < 3 ||
        summonerName.length > 16
      ) {
        logger.warn(
          COMMAND_NAME,
          `Nickname inválido fornecido: '${summonerName}'`
        );
        throw new Error('Nickname inválido. Deve ter entre 3 e 16 caracteres.');
      }

      logger.db(
        COMMAND_NAME,
        `Upsert usuário Discord: ${discord_tag} (${discord_id})...`
      );
      const { error: upsertUserError } = await supabase
        .from('Users')
        .upsert({ discord_id, discord_tag }, { onConflict: 'discord_id' });

      if (upsertUserError) {
        logger.error(
          COMMAND_NAME,
          `Falha no upsert do usuário ${discord_tag}.`,
          upsertUserError
        );
        throw new Error('Falha ao sincronizar seu usuário Discord.');
      }
      logger.db(
        COMMAND_NAME,
        `Usuário ${discord_tag} garantido na tabela Users.`
      );

      // ---> VERIFICA SE O USUÁRIO JÁ TEM CONTA VINCULADA <---
      logger.db(
        COMMAND_NAME,
        `Verificando se ${discord_tag} já possui conta vinculada...`
      );
      const { data: userExistingAccount, error: userCheckError } =
        await supabase
          .from('LoL_Accounts')
          .select('summoner_name')
          .eq('owner_discord_id', discord_id)
          .maybeSingle();

      if (userCheckError) {
        logger.error(
          COMMAND_NAME,
          `Erro ao verificar conta existente para ${discord_tag}.`,
          userCheckError
        );
        throw new Error('Erro ao verificar suas contas existentes.');
      }

      if (userExistingAccount) {
        logger.warn(
          COMMAND_NAME,
          `${discord_tag} já possui a conta '${userExistingAccount.summoner_name}' vinculada.`
        );
        await interaction.editReply({
          content: `**Erro:** Você já possui uma conta LoL vinculada (\`${userExistingAccount.summoner_name}\`). Para vincular uma nova, desvincule a atual primeiro (comando a ser implementado).`,
        });
        return;
      }
      // ---> FIM DA VERIFICAÇÃO <---

      logger.db(
        COMMAND_NAME,
        `Verificando se o nickname '${summonerName}' já foi registrado por outro usuário...`
      );
      const { data: nickExistingAccount, error: nickCheckError } =
        await supabase
          .from('LoL_Accounts')
          .select('owner_discord_id')
          .eq('summoner_name', summonerName)
          .maybeSingle();

      if (nickCheckError) {
        logger.error(
          COMMAND_NAME,
          `Erro ao buscar conta LoL '${summonerName}'.`,
          nickCheckError
        );
        throw new Error('Erro ao verificar o nickname no banco de dados.');
      }

      if (nickExistingAccount) {
        logger.warn(
          COMMAND_NAME,
          `Nickname '${summonerName}' já registrado por ${nickExistingAccount.owner_discord_id}.`
        );
        // Não menciona o outro usuário para privacidade, apenas informa que já está em uso
        await interaction.editReply({
          content: `**Erro:** O nickname \`${summonerName}\` já foi registrado por outro usuário.`,
        });
        return;
      }

      logger.db(
        COMMAND_NAME,
        `Registrando nova conta: '${summonerName}' para ${discord_tag}...`
      );
      const { error: insertError } = await supabase
        .from('LoL_Accounts')
        .insert({ owner_discord_id: discord_id, summoner_name: summonerName });

      if (insertError) {
        // Se a constraint única falhar
        if (insertError.code === '23505') {
          if (
            insertError.message.includes('LoL_Accounts_owner_discord_id_key')
          ) {
            logger.warn(
              COMMAND_NAME,
              `Constraint de usuário único violada para ${discord_tag}.`
            );
            await interaction.editReply({
              content: `**Erro:** Você já tem uma conta registrada. Aconteceu um erro inesperado durante a verificação.`,
            });
            return;
          }
          if (insertError.message.includes('LoL_Accounts_summoner_name_key')) {
            logger.warn(
              COMMAND_NAME,
              `Constraint de nickname único violada para '${summonerName}'.`
            );
            await interaction.editReply({
              content: `**Erro:** O nickname \`${summonerName}\` acabou de ser registrado por outra pessoa.`,
            });
            return;
          }
        }
        logger.error(
          COMMAND_NAME,
          `Falha ao registrar conta '${summonerName}'.`,
          insertError
        );
        throw new Error('Falha ao registrar a conta LoL.');
      }

      logger.success(
        COMMAND_NAME,
        `Conta '${summonerName}' registrada com sucesso para ${discord_tag}.`
      );
      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('✅ Conta Registrada com Sucesso!')
        .setDescription(
          `O nickname \`${summonerName}\` foi vinculado à sua conta Discord (<@${discord_id}>).`
        )
        .addFields({
          name: 'Próximos Passos',
          value:
            'Use `/processgame` com seus screenshots para registrar partidas ou `/profile` / `/history` para ver suas estatísticas.',
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      logger.info(COMMAND_NAME, 'Resposta de sucesso enviada ao usuário.');
    } catch (error: any) {
      logger.error(COMMAND_NAME, 'Erro durante o registro:', error);
      const errorOptions = {
        content: `❌ Ocorreu um erro: ${
          error.message || 'Erro desconhecido.'
        }. Verifique o nickname ou tente mais tarde.`,
        embeds: [],
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply(errorOptions);
        } else {
          await interaction.reply({ ...errorOptions, ephemeral: true });
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
