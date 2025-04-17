const fs = require('fs');
const path = require('path');
const config = require('../config.json');

module.exports = {
    name: 'help',
    description: 'Lists all commands or info about a specific command',
    execute(api, event, args) {
        const commandFiles = fs.readdirSync('./cmds').filter(file => file.endsWith('.js'));

        // If no arguments are provided, list all commands
        if (!args.length) {
            let helpMessage = '📋 Available Commands:\n\n';

            for (const file of commandFiles) {
                const command = require(`./${file}`);
                helpMessage += `• ${command.name}: ${command.description || 'No description'}\n`;
            }

            helpMessage += `\nYou can use commands with or without the "${config.prefix}" prefix.\n`;
            helpMessage += `Example: "${config.prefix}help" or just "help"`;

            api.sendMessage(helpMessage, event.threadID, event.messageID);
            return;
        }

        // If an argument is provided, show info about that specific command
        const commandName = args[0].toLowerCase();
        const commandPath = path.join(__dirname, `${commandName}.js`);

        if (fs.existsSync(commandPath)) {
            const command = require(commandPath);
            let commandInfo = `📝 Command: ${command.name}\n`;
            commandInfo += `Description: ${command.description || 'No description'}\n`;
            commandInfo += `Usage: ${command.usage || `${config.prefix}${command.name}`}`;

            api.sendMessage(commandInfo, event.threadID, event.messageID);
        } else {
            api.sendMessage(`Command "${commandName}" not found. Use "help" to see all commands.`, event.threadID, event.messageID);
        }
    }
};