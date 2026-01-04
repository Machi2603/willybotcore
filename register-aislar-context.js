import 'dotenv/config';
import {
  REST,
  Routes,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
} from 'discord.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

const COMMAND_NAME = 'Aislar';

const cmd = new ContextMenuCommandBuilder()
  .setName(COMMAND_NAME)
  .setType(ApplicationCommandType.User);

async function main() {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) throw new Error('Falta CLIENT_ID.');

  // Leer comandos globales existentes
  const existing = await rest.get(Routes.applicationCommands(clientId));

  // Buscar si ya existe
  const found = existing.find(c => c.name === COMMAND_NAME && c.type === ApplicationCommandType.User);

  if (found) {
    // Actualizar
    await rest.patch(Routes.applicationCommand(clientId, found.id), { body: cmd.toJSON() });
    console.log(`Context command actualizado: ${COMMAND_NAME}`);
  } else {
    // Crear
    await rest.post(Routes.applicationCommands(clientId), { body: cmd.toJSON() });
    console.log(`Context command creado: ${COMMAND_NAME}`);
  }
}

main().catch(console.error);
