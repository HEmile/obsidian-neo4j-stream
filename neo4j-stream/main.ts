import {
  MetadataCache,
  Plugin, Vault,
} from 'obsidian';
import type {
  INeo4jStreamSettings,
} from './settings';
import {Neo4jStream} from './stream';
import {DefaultNeo4jStreamSettings, Neo4jStreamSettingsTab} from './settings';
import {STATUS_OFFLINE} from './constants';


export default class Neo4jPlugin extends Plugin {
    settings: INeo4jStreamSettings;
    statusBar: HTMLElement;
    neo4jStream: Neo4jStream;
    vault: Vault;
    metadata: MetadataCache

    async onload(): Promise<void> {
      super.onload();
      console.log('Loading Neo4j stream');
      this.settings = Object.assign({}, DefaultNeo4jStreamSettings, await this.loadData());

      this.vault = this.app.vault;
      this.metadata = this.app.metadataCache;

      this.statusBar = this.addStatusBarItem();
      this.statusBar.setText(STATUS_OFFLINE);
      this.neo4jStream = new Neo4jStream(this);
      this.addChild(this.neo4jStream);

      this.addCommand({
        id: 'restart-stream',
        name: 'Restart Neo4j stream',
        callback: () => {
          console.log('Restarting stream');
          this.neo4jStream.stop();
          this.neo4jStream.start();
        },
      });
      this.addCommand({
        id: 'stop-stream',
        name: 'Stop Neo4j stream',
        callback: () => {
          this.neo4jStream.stop();
        },
      });

      // this.addCommand({
      //   id: 'open-bloom-link',
      //   name: 'Open note in Neo4j Bloom',
      //   callback: () => {
      //       if (!this.stream_process) {
      //           new Notice("Cannot open in Neo4j Bloom as neo4j stream is not active.")
      //       }
      //       let active_view = this.app.workspace.getActiveViewOfType(MarkdownView);
      //       if (active_view == null) {
      //           return;
      //       }
      //       let name = active_view.getDisplayText();
      //       // active_view.getState().
      //
      //       console.log(encodeURI("neo4j://graphapps/neo4j-bloom?search=SMD_no_tags with name " + name));
      //       open(encodeURI("neo4j://graphapps/neo4j-bloom?search=SMD_no_tags with name " + name));
      //       // require("electron").shell.openExternal("www.google.com");
      //   },
      // });


      this.addSettingTab(new Neo4jStreamSettingsTab(this.app, this));
      this.app.workspace.onLayoutReady(() => {
        this.neo4jStream.start();
      });
    }

    // nodeCypher(label: string): string {
    //   return 'MATCH (n) WHERE n.name="' + label +
    //         '" AND n.' + PROP_VAULT + '="' + this.app.vault.getName() +
    //         '" RETURN n';
    // }
    //
    // localNeighborhoodCypher(label:string): string {
    //   return 'MATCH (n {name: "' + label +
    //         '", ' + PROP_VAULT + ':"' + this.app.vault.getName() +
    //         '"}) OPTIONAL MATCH (n)-[r]-(m) RETURN n,r,m';
    // }

    // executeQuery() {
    //   // Code taken from https://github.com/mrjackphil/obsidian-text-expand/blob/0.6.4/main.ts
    //   const currentView = this.app.workspace.activeLeaf.view;
    //
    //   if (!(currentView instanceof MarkdownView)) {
    //     return;
    //   }
    //
    //   const cmDoc = currentView.sourceMode.cmEditor;
    //   const curNum = cmDoc.getCursor().line;
    //   const query = this.getContentBetweenLines(curNum, '```cypher', '```', cmDoc);
    //   if (query.length > 0) {
    //     const leaf = this.app.workspace.splitActiveLeaf(this.settings.splitDirection);
    //     try {
    //       // TODO: Pass query.
    //       // const neovisView = new NeoVisView((leaf, this, name, [new ObsidianStore(this)]);
    //       // leaf.open(neovisView);
    //     } catch (e) {
    //       if (e instanceof Neo4jError) {
    //         new Notice('Invalid cypher query. Check console for more info.');
    //       } else {
    //         throw e;
    //       }
    //     }
    //   }
    // }
    async onunload() {
      super.onunload();
      console.log('Unloading Neo4j stream');
    }
}
