import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

// /willybot texto: "..."
const willybotCommand = new SlashCommandBuilder()
  .setName('willybot')
  .setDescription('habla con willybot')
  .addStringOption(opt =>
    opt.setName('texto')
      .setDescription('Escribe lo que quieres decirle a WillyBot')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2000)
  );

// /censura activada: true/false
const censuraCommand = new SlashCommandBuilder()
  .setName('censura')
  .setDescription('Activa o desactiva la censura de Willybot')
  .addBooleanOption(opt =>
    opt.setName('activada')
      .setDescription('Si: Censura activada. No: Censura desactivada')
      .setRequired(true)
  );

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

async function main() {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID), // GLOBAL
    { body: [willybotCommand.toJSON(), censuraCommand.toJSON()] }
  );
  console.log('Slash commands GLOBAL registrados: /willybot y /censura');
}

main().catch(console.error);
