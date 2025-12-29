import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const command = new SlashCommandBuilder()
  .setName('willybot')
  .setDescription('habla con willybot')
  .addStringOption(opt =>
    opt.setName('texto')
      .setDescription('Escribe lo que quieres decirle a WillyBot')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2000)
  );

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

async function main() {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID), // <-- GLOBAL
    { body: [command.toJSON()] }
  );
  console.log('Slash command GLOBAL registrado.');
}

main().catch(console.error);
