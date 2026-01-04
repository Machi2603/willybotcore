import 'dotenv/config';
import axios from 'axios';
import { Readable } from 'node:stream';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';

const activeVoiceByGuild = new Map(); // guildId -> { connection, player }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

async function handleWillyTTS(interaction) {
  const mensaje = interaction.options.getString('mensaje', true);

  if (!interaction.guild) {
    await interaction.editReply('Este comando solo funciona dentro de un servidor.');
    return;
  }

  // Detectar canal de voz del usuario
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannel = member.voice?.channel ?? null;

  if (!voiceChannel) {
    await interaction.editReply('Conéctate a un canal de voz primero.');
    return;
  }

  // Mensaje público en el chat
  await interaction.editReply(`WillyTTS: ${mensaje}`);

  // Si ya había algo sonando en el server, lo cortamos
  const prev = activeVoiceByGuild.get(interaction.guildId);
  if (prev?.connection) {
    try { prev.player?.stop(true); } catch {}
    try { prev.connection.destroy(); } catch {}
    activeVoiceByGuild.delete(interaction.guildId);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    await interaction.followUp('Faltan ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en las variables de entorno.');
    return;
  }

  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'opus_48000_64';

  // Conectar a voz
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const player = createAudioPlayer();
    connection.subscribe(player);
    activeVoiceByGuild.set(interaction.guildId, { connection, player });

    // Pedir TTS a ElevenLabs (audio Ogg Opus)
    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
      `?output_format=${encodeURIComponent(outputFormat)}&enable_logging=false`;

    const { data } = await axios.post(
      url,
      { text: mensaje, model_id: modelId },
      {
        responseType: 'arraybuffer',
        timeout: 120000,
        headers: {
          Accept: 'audio/ogg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
      }
    );

    const audioStream = Readable.from(Buffer.from(data));
    const resource = createAudioResource(audioStream, { inputType: StreamType.OggOpus });
    player.play(resource);

    await entersState(player, AudioPlayerStatus.Playing, 15_000);
    await entersState(player, AudioPlayerStatus.Idle, 10 * 60 * 1000);
  } finally {
    try { connection.destroy(); } catch {}
    activeVoiceByGuild.delete(interaction.guildId);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  console.log('[interaction]', {
    type: interaction.type,
    isChatInput: interaction.isChatInputCommand?.(),
    commandName: interaction.commandName,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    user: interaction.user?.username,
  });

  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;
    if (cmd !== 'willybot' && cmd !== 'censura' && cmd !== 'willytts') return;

    // Regla 3s: defer siempre primero
    await interaction.deferReply();

    // /willytts no pasa por n8n
    if (cmd === 'willytts') {
      await handleWillyTTS(interaction);
      return;
    }

    // Payload hacia n8n (willybot/censura)
    const payload = {
      command: cmd,
      interactionId: interaction.id,
      userId: interaction.user.id,
      userName: interaction.user.username,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      options: {},
    };

    if (cmd === 'willybot') {
      const texto = interaction.options.getString('texto', true);
      payload.texto = texto;
      payload.options.texto = texto;
    }

    if (cmd === 'censura') {
      const activada = interaction.options.getBoolean('activada', true);
      payload.activada = activada;
      payload.options.activada = activada;
    }

    const headers = process.env.WILLYBOT_SECRET
      ? { 'x-willybot-secret': process.env.WILLYBOT_SECRET }
      : {};

    const { data } = await axios.post(process.env.N8N_WEBHOOK_URL, payload, {
      timeout: 120000,
      headers,
    });

    const answer =
      (data && (data.answer || data.text || data.message)) ??
      'No he recibido respuesta válida.';

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

