/**
 * Plugins that ship with node-log-viewer. The UI uses this list to show plugins that are
 * available but not registered on the logger, together with the code needed to add them.
 */
export interface BuiltinPluginInfo {
  /** Plugin `name` as reported by the plugin instance. */
  name: string;
  title: string;
  description: string;
  /** Factory exported from `node-log-viewer` (and `node-log-viewer/nest`). */
  factory: string;
  /** Name of the option holding the webhook/credential, used in the setup snippet. */
  credentialOption: string;
  /** Environment variable suggested in the setup snippet. */
  envVar: string;
  /** Where to obtain the credential. */
  docsUrl: string;
}

export const BUILTIN_PLUGINS: readonly BuiltinPluginInfo[] = [
  {
    name: 'discord',
    title: 'Discord',
    description: 'Send log entries to a Discord channel via an incoming webhook.',
    factory: 'discordPlugin',
    credentialOption: 'webhookUrl',
    envVar: 'DISCORD_WEBHOOK_URL',
    docsUrl: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
  },
  {
    name: 'slack',
    title: 'Slack',
    description: 'Send log entries to a Slack channel via an incoming webhook.',
    factory: 'slackPlugin',
    credentialOption: 'webhookUrl',
    envVar: 'SLACK_WEBHOOK_URL',
    docsUrl: 'https://api.slack.com/messaging/webhooks',
  },
];
