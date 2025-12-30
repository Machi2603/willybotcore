import 'dotenv/config';
import axios from 'axios';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
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

    // Acepta /willybot y /censura
    const cmd = interaction.commandName;
    if (cmd !== 'willybot' && cmd !== 'censura') return;

    // Cumple la regla de los 3s siempre
    // (opcional: /censura en privado)
    await interaction.deferReply({ ephemeral: cmd === 'censura' });

    // Payload base (mantiene lo que ya enviabas)
    const payload = {
      command: cmd, // <-- para que en n8n hagas Switch por comando
      userId: interaction.user.id,
      userName: interaction.user.username,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
    };

    // Datos específicos por comando
    if (cmd === 'willybot') {
      const texto = interaction.options.getString('texto', true);
      console.log('[willybot] texto:', texto);
      payload.texto = texto;
    }

    if (cmd === 'censura') {
      const activada = interaction.options.getBoolean('activada', true);
      console.log('[censura] activada:', activada);
      payload.activada = activada;
    }

    console.log(`[${cmd}] calling n8n:`, process.env.N8N_WEBHOOK_URL);

    const { data } = await axios.post(process.env.N8N_WEBHOOK_URL, payload, {
      timeout: 120000,
    });

    const answer =
      (data && (data.answer || data.text || data.message)) ??
      'No he recibido respuesta válida.';

    console.log(`[${cmd}] n8n answer length:`, String(answer).length);

    await interaction.editReply(String(answer).slice(0, 2000));
  } catch (err) {
    console.error('[bot] ERROR:', err?.response?.data || err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Error procesando tu solicitud.');
    } else {
      await interaction.reply({ content: 'Error procesando tu solicitud.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
