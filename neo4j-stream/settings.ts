import {App, PluginSettingTab, Setting} from 'obsidian';
import type Neo4jPlugin from './main';


export interface INeo4jStreamSettings {
    // indexContent: boolean; // neo4j
    password: string;
    typedLinkPrefix: string;
    neo4jServerPort: number;
    server: string;
    indexContent: boolean;
    debug: boolean;
}


export const DefaultNeo4jStreamSettings: INeo4jStreamSettings = {
  password: '',
  typedLinkPrefix: '-',
  neo4jServerPort: 7687,
  server: 'localhost',
  indexContent: true,
  debug: false,
};


export class Neo4jStreamSettingsTab extends PluginSettingTab {
    plugin: Neo4jPlugin;
    constructor(app: App, plugin: Neo4jPlugin) {
      super(app, plugin);
      this.plugin = plugin;
    }

    display(): void {
      const {containerEl} = this;
      containerEl.empty();

      containerEl.createEl('h3');
      containerEl.createEl('h3', {text: 'Neo4j Stream'});

      const doc_link = document.createElement('a');
      doc_link.href = 'https://juggl.io';
      doc_link.target = '_blank';
      doc_link.innerHTML = 'the documentation';

      const discord_link = document.createElement('a');
      discord_link.href = 'https://discord.gg/sAmSGpaPgM';
      discord_link.target = '_blank';
      discord_link.innerHTML = 'the Discord server';

      const introPar = document.createElement('p');
      introPar.innerHTML =
          'Check out ' + doc_link.outerHTML + ' for documentation on how to use the plugin. <br>' +
            'Join ' + discord_link.outerHTML + ' for help, nice discussion and insight into development.';

      containerEl.appendChild(introPar);

      new Setting(containerEl)
          .setName('Neo4j server')
          .setDesc('Set the Neo4j server to use. Default localhost.')
          .addText((text) => {
            text.setValue(this.plugin.settings.server + '')
                .setPlaceholder('localhost')
                .onChange((new_value) => {
                  this.plugin.settings.server = new_value.trim();
                  this.plugin.saveData(this.plugin.settings);
                });
          });

      new Setting(containerEl)
          .setName('Neo4j server port')
          .setDesc('Set the port of the Neo4j server. Default 7687.')
          .addText((text) => {
            text.setValue(this.plugin.settings.neo4jServerPort + '')
                .setPlaceholder('7687')
                .onChange((new_value) => {
                  this.plugin.settings.neo4jServerPort = parseInt(new_value.trim());
                  this.plugin.saveData(this.plugin.settings);
                });
          });

      new Setting(containerEl)
          .setName('Neo4j database password')
          .setDesc('The password of your neo4j graph database. WARNING: This is stored in plaintext in your vault. ' +
                'Don\'t use sensitive passwords here!')
          .addText((text) => {
            text.setPlaceholder('')
                .setValue(this.plugin.settings.password)
                .onChange((newFolder) => {
                  this.plugin.settings.password = newFolder;
                  this.plugin.saveData(this.plugin.settings);
                }).inputEl.setAttribute('type', 'password');
          });

      new Setting(containerEl)
          .setName('Index note content')
          .setDesc('This will full-text index the content of notes. ' +
                'This allows searching within notes using the Neo4j Bloom search bar. However, it could decrease performance.')
          .addToggle((toggle) => {
            toggle.setValue(this.plugin.settings.indexContent)
                .onChange((new_value) => {
                  this.plugin.settings.indexContent = new_value;
                  this.plugin.saveData(this.plugin.settings);
                });
          });

      new Setting(containerEl)
          .setName('Typed links prefix')
          .setDesc('Prefix to use for typed links. Default is \'-\'. Requires a server restart.')
          .addText((text) => {
            text.setPlaceholder('')
                .setValue(this.plugin.settings.typedLinkPrefix)
                .onChange((new_folder) => {
                  this.plugin.settings.typedLinkPrefix = new_folder;
                  this.plugin.saveData(this.plugin.settings);
                });
          });


      new Setting(containerEl)
          .setName('Debug')
          .setDesc('Enable debug mode, which prints a lot of stuff in the developers console.')
          .addToggle((toggle) => {
            toggle.setValue(this.plugin.settings.debug)
                .onChange((new_value) => {
                  this.plugin.settings.debug = new_value;
                  this.plugin.saveData(this.plugin.settings);
                });
          });
    }
}
