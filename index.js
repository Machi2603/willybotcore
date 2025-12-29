import 'dotenv/config';
import axios from 'axios';
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'willybot') return;

    const texto = interaction.options.getString('texto', true);

    // Regla 3 segundos
    await interaction.deferReply();

    // Llamada a n8n
    const { data } = await axios.post(process.env.N8N_WEBHOOK_URL, {
      texto,
      userId: interaction.user.id,
      userName: interaction.user.username,
      channelId: interaction.channelId,
      guildId: interaction.guildId
    }, { timeout: 120000 });

    const answer = (data && (data.answer || data.text || data.message)) ?? 'No he recibido respuesta válida.';
    await interaction.editReply(String(answer).slice(0, 2000));
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Error procesando tu solicitud.');
    } else {
      await interaction.reply({ content: 'Error procesando tu solicitud.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
