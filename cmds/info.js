const os = require('os');
const config = require('../config.json');
const package = require('../package.json');

module.exports = {
    name: 'info',
    description: 'Display information about the bot',
    execute(api, event, args) {
        const uptime = formatTime(process.uptime());
        const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const platform = `${os.type()} ${os.release()}`;
        
        const infoMessage = `
📊 Bot Information:
🤖 Name: ${config.botName}
⏱️ Uptime: ${uptime}
💾 Memory Usage: ${memory} MB
🖥️ Platform: ${platform}
📦 ws3-fca version: ${package.dependencies['ws3-fca'] || 'latest'}

Made with ❤️ using ws3-fca
        `;
        
        api.sendMessage(infoMessage.trim(), event.threadID, event.messageID);
    }
};

function formatTime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let result = '';
    if (days > 0) result += `${days}d `;
    if (hours > 0) result += `${hours}h `;
    if (minutes > 0) result += `${minutes}m `;
    result += `${secs}s`;
    
    return result;
}