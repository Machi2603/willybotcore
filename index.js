import 'dotenv/config';
import axios from 'axios';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Log mínimo para ver que llegan interacciones
  console.log('[interaction]', {
    type: interaction.type,
    isChatInput: interaction.isChatInputCommand?.(),
    commandName: interaction.commandName,
    applicationId: interaction.applicationId,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    user: interaction.user?.username,
  });

  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'willybot') return;

    const texto = interaction.options.getString('texto', true);
    console.log('[willybot] texto:', texto);

    await interaction.deferReply();

    console.log('[willybot] calling n8n:', process.env.N8N_WEBHOOK_URL);
    const { data } = await axios.post(
      process.env.N8N_WEBHOOK_URL,
      {
        texto,
        userId: interaction.user.id,
        userName: interaction.user.username,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
      },
      { timeout: 120000 }
    );

    const answer = (data && (data.answer || data.text || data.message)) ?? 'No he recibido respuesta válida.';
    console.log('[willybot] n8n answer length:', String(answer).length);

    await interaction.editReply(String(answer).slice(0, 2000));
  } catch (err) {
    console.error('[willybot] ERROR:', err?.response?.data || err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Error procesando tu solicitud.');
    } else {
      await interaction.reply({ content: 'Error procesando tu solicitud.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
