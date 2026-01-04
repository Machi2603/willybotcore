import 'dotenv/config';
import axios from 'axios';
import { Readable } from 'node:stream';
import { Client, GatewayIntentBits, Events, PermissionFlagsBits } from 'discord.js';
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

// Nombre exacto del comando de clic derecho (tiene que coincidir con el que registras)
const AISLAR_COMMAND_NAME = 'Aislar';
const AISLAR_MINUTES = 10;

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

  // Permisos del bot (Connect/Speak)
  const me = await interaction.guild.members.fetchMe();
  const perms = voiceChannel.permissionsFor(me);
  if (!perms?.has(['Connect', 'Speak'])) {
    await interaction.editReply('No tengo permisos para hablar en ese canal (Connect/Speak).');
    return;
  }

  await interaction.editReply(`WillyTTS: ${mensaje}`);

  // Cortar audio anterior en ese server (si lo hubiese)
  const prev = activeVoiceByGuild.get(interaction.guildId);
  if (prev?.connection) {
    try { prev.player?.stop(true); } catch {}
    try { prev.connection.destroy(); } catch {}
    activeVoiceByGuild.delete(interaction.guildId);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    await interaction.followUp('Faltan ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en variables de entorno.');
    return;
  }

  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'opus_48000_64';

  // 1) Pedir TTS primero (si falla, NO entramos a voz)
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
    `?output_format=${encodeURIComponent(outputFormat)}&enable_logging=false`;

  const tts = await axios.post(
    url,
    { text: mensaje, model_id: modelId },
    {
      responseType: 'arraybuffer',
      timeout: 120000,
      validateStatus: () => true,
      headers: {
        Accept: 'audio/ogg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
    }
  );

  const contentType = String(tts.headers?.['content-type'] || '');
  const buf = Buffer.from(tts.data || []);

  // Si NO es audio, es error (JSON/texto). Lo mostramos y salimos.
  if (tts.status < 200 || tts.status >= 300 || !contentType.startsWith('audio/')) {
    const text = buf.toString('utf8');

    console.error('[willytts] ElevenLabs ERROR', {
      status: tts.status,
      contentType,
      body: text,
    });

    const resumen = text.length > 180 ? text.slice(0, 180) + '...' : text;
    await interaction.followUp(
      `ElevenLabs devolvió error (${tts.status}). Revisa logs. Detalle: ${resumen}`
    );
    return;
  }

  // 2) Si es audio, reproducir en voz
  let stream;
  let inputType;

  try {
    const { stream: s, type } = await demuxProbe(Readable.from(buf));
    stream = s;
    inputType = type;
  } catch {
    stream = Readable.from(buf);
    inputType = StreamType.OggOpus;
  }

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

    const resource = createAudioResource(stream, { inputType });
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
    isUserCtx: interaction.isUserContextMenuCommand?.(),
    commandName: interaction.commandName,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    user: interaction.user?.username,
  });

  try {
    // ========= 1) CLIC DERECHO (Apps) -> Aislar =========
    if (interaction.isUserContextMenuCommand?.()) {
      if (interaction.commandName !== AISLAR_COMMAND_NAME) return;

      await interaction.deferReply({ ephemeral: true });

      if (!interaction.guild) {
        await interaction.editReply('Este comando solo funciona dentro de un servidor.');
        return;
      }

      // Permiso de moderación del bot
      const me = await interaction.guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        await interaction.editReply('No tengo permiso de "Moderar miembros" (Moderate Members).');
        return;
      }

      const targetId = interaction.targetId;
      const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

      if (!targetMember) {
        await interaction.editReply('No puedo encontrar a ese usuario en este servidor.');
        return;
      }

      // Evitar aislar al propio bot o a uno mismo (opcional, pero práctico)
      if (targetMember.id === me.id) {
        await interaction.editReply('No puedo aislarme a mí mismo.');
        return;
      }

      const ms = AISLAR_MINUTES * 60 * 1000;

      try {
        await targetMember.timeout(ms, `Aislar ${AISLAR_MINUTES}m por ${interaction.user.tag}`);
        await interaction.editReply(`He aislado a ${targetMember.user.tag} durante ${AISLAR_MINUTES} minutos.`);
      } catch (e) {
        console.error('[aislar] ERROR:', e);
        await interaction.editReply(
          'No he podido aislar a ese usuario. Revisa jerarquía de roles (el rol del bot debe estar por encima).'
        );
      }

      return;
    }

    // ========= 2) SLASH COMMANDS =========
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;
    if (cmd !== 'willybot' && cmd !== 'censura' && cmd !== 'willytts') return;

    // Regla 3s: defer siempre primero
    await interaction.deferReply();

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
