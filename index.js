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
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';

const activeVoiceByGuild = new Map();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

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

    const cmd = interaction.commandName;
    if (cmd !== 'willybot' && cmd !== 'censura' && cmd !== 'willytts') return;

    // Regla 3s: ACK inmediato siempre
    await interaction.deferReply();

    if (cmd === 'willytts') {
      const mensaje = interaction.options.getString('mensaje', true);

      if (!interaction.guild) {
        await interaction.editReply('Este comando solo funciona dentro de un servidor.');
        return;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const voiceChannel = member.voice?.channel ?? null;

      if (!voiceChannel) {
        await interaction.editReply('conéctate a un canal de voz');
        return;
      }

      await interaction.editReply(`WillyTTS: ${mensaje}`);

      const prev = activeVoiceByGuild.get(interaction.guildId);
      if (prev?.connection) {
        try {
          prev.player?.stop(true);
        } catch {
          // ignore
        }
        try {
          prev.connection.destroy();
        } catch {
          // ignore
        }
        activeVoiceByGuild.delete(interaction.guildId);
      }

      const apiKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_VOICE_ID;
      if (!apiKey || !voiceId) {
        await interaction.followUp('Faltan variables de entorno ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID.');
        return;
      }

      const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
      const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'opus_48000_64';
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
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

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

        const player = createAudioPlayer();
        connection.subscribe(player);
        activeVoiceByGuild.set(interaction.guildId, { connection, player });

        const audioStream = Readable.from(Buffer.from(data));
        const resource = createAudioResource(audioStream, { inputType: StreamType.OggOpus });
        player.play(resource);

        await entersState(player, AudioPlayerStatus.Playing, 15_000);
        await entersState(player, AudioPlayerStatus.Idle, 10 * 60 * 1000);
      } finally {
        connection.destroy();
        activeVoiceByGuild.delete(interaction.guildId);
      }

      return;
    }

    // Payload base (lo que n8n necesita para rutear y guardar por usuario)
    const payload = {
      command: cmd,                  // para Switch en n8n
      interactionId: interaction.id, // opcional, útil para logs
      userId: interaction.user.id,
      userName: interaction.user.username,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      options: {},                   // todas las opciones del comando aquí
    };

    // Opciones por comando (y compatibilidad hacia atrás)
    if (cmd === 'willybot') {
      const texto = interaction.options.getString('texto', true);
      console.log('[willybot] texto:', texto);
      payload.texto = texto;                 // compatibilidad
      payload.options.texto = texto;         // recomendado
    }

    if (cmd === 'censura') {
      const activada = interaction.options.getBoolean('activada', true);
      console.log('[censura] activada:', activada);
      payload.activada = activada;           // compatibilidad
      payload.options.activada = activada;   // recomendado
    }

    console.log(`[${cmd}] calling n8n:`, process.env.N8N_WEBHOOK_URL);

    // (Opcional) secreto compartido para que nadie te llame el webhook
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

