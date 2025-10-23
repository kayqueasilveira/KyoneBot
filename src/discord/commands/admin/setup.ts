import { createCommand } from '#base';
import { supabase } from '#database';
import { logger } from '#functions';
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';

const COMMAND_NAME = 'setup';

createCommand({
  name: COMMAND_NAME,
  description: 'Configurações do bot neste servidor.',
  type: ApplicationCommandType.ChatInput,
  // Restringe o comando para quem pode gerenciar o servidor
  defaultMemberPermissions: [PermissionFlagsBits.ManageGuild],
  // Garante que o comando só aparece em servidores
  dmPermission: false,

  // --- Subcomando para logs ---
  options: [
    {
      name: 'logs',
      description:
        'Configura o canal para receber logs de partidas processadas.',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'channel',
          description: 'O canal de texto onde os logs serão enviados.',
          type: ApplicationCommandOptionType.Channel,
          required: true,
          // Restringe a seleção apenas para canais de texto do servidor
          channelTypes: [ChannelType.GuildText],
        },
      ],
    },
  ],

  async run(interaction) {
    // Verifica se está num servidor
    if (!interaction.inGuild()) return;

    const subcommand = interaction.options.getSubcommand(true);

    // --- Lógica para o Subcomando 'logs' ---
    if (subcommand === 'logs') {
      const channel = interaction.options.getChannel(
        'channel',
        true
      ) as TextChannel; // Cast seguro devido a channelTypes
      const guildId = interaction.guildId;

      logger.info(
        COMMAND_NAME,
        `Subcomando 'logs' iniciado por ${interaction.user.tag} no servidor ${guildId} para o canal #${channel.name} (${channel.id})`
      );

      await interaction.deferReply({ ephemeral: true }); // Resposta visível só para quem usou o comando

      try {
        logger.db(
          COMMAND_NAME,
          `Atualizando canal de log para ${channel.id} na guild ${guildId}...`
        );
        const { error } = await supabase.from('Guild_Settings').upsert(
          { guild_id: guildId, log_channel_id: channel.id },
          { onConflict: 'guild_id' } // Atualiza se já existir config para a guild
        );

        if (error) {
          logger.error(
            COMMAND_NAME,
            `Falha ao salvar canal de log para guild ${guildId}.`,
            error
          );
          throw new Error(
            'Não foi possível salvar a configuração no banco de dados.'
          );
        }

        logger.success(
          COMMAND_NAME,
          `Canal de log #${channel.name} (${channel.id}) configurado com sucesso para guild ${guildId}.`
        );

        const embed = new EmbedBuilder()
          .setColor('#2ECC71') // Verde
          .setTitle('✅ Canal de Logs Configurado!')
          .setDescription(
            `As notificações de partidas processadas serão enviadas para o canal ${channel}.`
          )
          .setTimestamp();

        // Tenta enviar uma mensagem de confirmação no canal configurado
        try {
          await channel.send({
            content: `Este canal foi configurado para receber logs de partidas por ${interaction.user}.`,
          });
          logger.info(
            COMMAND_NAME,
            `Mensagem de confirmação enviada para #${channel.name}`
          );
        } catch (sendError: any) {
          logger.warn(
            COMMAND_NAME,
            `Não foi possível enviar mensagem de confirmação para #${channel.name}. Verifique permissões.`,
            sendError.message
          );
          embed.setFooter({
            text: '⚠️ Não consegui enviar uma mensagem de confirmação neste canal. Verifique minhas permissões.',
          });
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error: any) {
        logger.error(
          COMMAND_NAME,
          `Erro ao configurar canal de logs para guild ${guildId}:`,
          error
        );
        await interaction
          .editReply({
            content: `❌ Ocorreu um erro ao configurar o canal de logs: ${
              error.message || 'Erro desconhecido.'
            }`,
            embeds: [],
          })
          .catch((e) =>
            logger.error(COMMAND_NAME, 'Falha ao editar resposta de erro.', e)
          );
      }
    }
  },
});
