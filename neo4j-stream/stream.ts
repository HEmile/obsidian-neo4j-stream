import type Neo4jViewPlugin from './main';
import {
  Component,
  EventRef, Events,
  getLinkpath, LinkCache,
  MetadataCache, Notice,
  Vault,
  Workspace, WorkspaceLeaf,
} from 'obsidian';
import type {INeo4jStreamSettings} from './settings';
import {
  TAbstractFile, TFile,
} from 'obsidian';
import {Query, node, relation, NodePattern} from 'cypher-query-builder';
import type {Driver, Result, ResultSummary, Session} from 'neo4j-driver';
import {SyncQueue} from './sync';
import neo4j from 'neo4j-driver';
import {basename} from 'path';
import {ITypedLink, ITypedLinkProperties, nodeDangling, nodeFromFile} from 'juggl-api';
import type {SetProperties} from 'cypher-query-builder/dist/typings/clauses/set';

export const CAT_DANGLING = 'SMD_dangling';
export const CAT_NO_TAGS = 'SMD_no_tags';
export const nameRegex = '[^\\W\\d]\\w*';
export const initialTags = ['image', 'audio', 'video', 'pdf', 'file', CAT_NO_TAGS, CAT_DANGLING];
// Match around [[ and ]], and ensure content isn't a wikilnk closure
// This doesn't explicitly parse aliases.
export const wikilinkRegex = '\\[\\[([^\\]\\r\\n]+?)\\]\\]';

class QueryMetadata {
    nodeIndex: number=0;
    nodeVars: Record<string, string>={};

    nextNodeVar(name: string, prefix:string='n'): string {
      const varName = `${prefix}${this.nodeIndex.toString()}`;
      this.nodeVars[name] = varName;
      this.nodeIndex += 1;
      return varName;
    }

    values() {
      return Object.keys(this.nodeVars).map((k) => this.nodeVars[k]);
    }
}

interface StreamNode {
  labels: string[];
  properties: any;
}


export class Neo4jStream extends Component {
    plugin: Neo4jViewPlugin;
    workspace: Workspace;
    settings: INeo4jStreamSettings;
    vault: Vault;
    metadataCache: MetadataCache;
    driver: Driver;
    lastFileEvent: string;
    eventQueue: SyncQueue;

    constructor(plugin: Neo4jViewPlugin) {
      super();
      this.plugin = plugin;
      this.workspace = plugin.app.workspace;
      this.vault = plugin.app.vault;
      this.settings = plugin.settings;
      this.metadataCache = plugin.app.metadataCache;
      this.eventQueue = new SyncQueue(this);
    }

    public async start() {
      if (this.driver) {
        await this.driver.close();
      }

      this.driver = neo4j.driver('neo4j://localhost',
          neo4j.auth.basic('neo4j', this.settings.password), {
            maxTransactionRetryTime: 30000,
          });
      const connection = this.session();
      if (this.settings.debug) {
        console.log('Removing existing data');
      }

      // await this.connection.run("MATCH (n) RETURN n LIMIT 10").then(res => {
      //     console.log(res);
      // });

      await this.executeQueries([new Query()
          .matchNode('n', {SMD_vault: this.vault.getName()})
          .detachDelete('n')]);
      console.log('Iterating md files');
      // let noteQueries: Query[] = [];
      const markdownFiles = this.vault.getMarkdownFiles();
      let query = new Query();
      const queryMetadata = new QueryMetadata();

      for (const file of markdownFiles) {
        queryMetadata.nextNodeVar(file.basename);
        query = await this.queryCreateNote(file, query, queryMetadata);
      }


      for (const file of markdownFiles) {
        await this.queryCreateRels(file, query, queryMetadata);
      }

      console.log('Pushing to Neo4j');
      await this.executeQueries([query], connection);

      // TODO: Define schema/indexes

      new Notice('Neo4j stream online!');
      this.plugin.statusBar.setText('Neo4j stream online');

      await connection.close();
    }

    public session(): Session {
      return this.driver.session();
    }

    public async createNode(file: TFile, name: string): Promise<StreamNode> {
      let nodeDef = null;
      if (file) {
        nodeDef = await nodeFromFile(file, this.plugin);
      } else {
        nodeDef = nodeDangling(name);
      }
      nodeDef.data.vault = this.vault.getName();
      nodeDef.data.obsidian_url = `obsidian://open?vault=${encodeURIComponent(this.vault.getName())}&file=${encodeURIComponent(nodeDef.data.name)}`;
      // @ts-ignore
      const labels = nodeDef.classes.replaceAll('-', '_').split(' ');
      return {
        labels: labels,
        properties: nodeDef.data,
      };
    }

    public runQuery(query: Query, session: Session|null=null): Result {
      let newSess = false;
      if (session === null) {
        newSess = true;
        session = this.driver.session();
      }
      const queryO = query.buildQueryObject();
      if (this.settings.debug) {
        console.log(queryO);
      }

      const q = session.run(queryO.query, queryO.params);
      if (newSess) {
        q.subscribe({
          async onCompleted(summary: ResultSummary) {
            await session.close();
          },
        });
      }
      return q;
    }

    public async executeQueries(queries: Query[], session: Session|null=null) {
      for (const query of queries) {
        // Note: The await here is important, as a connection cannot run multiple transactions simultaneously.
        await this.runQuery(query, session).then((value) => {
          if (this.settings.debug) {
            console.log(value);
          }
        }).catch((reason) => {
          console.log('Query failed');
          console.log(query.buildQueryObject());
          console.log(reason);
        });
      }
    }

    public node(varName: string, name: string): NodePattern {
      return node(varName, {name: name, vault: this.vault.getName()});
    }

    public async queryUpdateNote(file: TFile, query: Query, queryMetadata: QueryMetadata): Promise<Query> {
      return this.queryCreateOrUpdateNote(file, query, queryMetadata, true);
    }

    public async queryCreateNote(file: TFile, query: Query, queryMetadata: QueryMetadata): Promise<Query> {
      return this.queryCreateOrUpdateNote(file, query, queryMetadata, false);
    }

    async queryCreateOrUpdateNote(file: TFile, query: Query, queryMetadata: QueryMetadata, update:boolean): Promise<Query> {
      const nodeDef = await this.createNode(file, file.name);
      if (nodeDef) {
        const nodeVar = queryMetadata.nodeVars[file.basename];
        if (update) {
          return query.set({
            labels: {
              [nodeVar]: nodeDef.labels,
            },
            values: {
              [nodeVar]: nodeDef.properties,
            },
          }, {
            merge: false,
          });
        } else {
          return query.createNode(nodeVar,
              nodeDef.labels,
              nodeDef.properties,
          );
        }
      }
      console.log('File without metadata');
      console.log(file);
      return null;
    }

    regexEscape(str: string) {
      return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }

    public parseTypedLink(link: LinkCache, line: string): ITypedLink {
      // TODO: This is something specific I use, but shouldn't keep being in this repo.
      const regexPublishedIn = new RegExp(
          `^${this.regexEscape(this.settings.typedLinkPrefix)} (publishedIn) (\\d\\d\\d\\d) (${wikilinkRegex},? *)+$`);
      const matchPI = regexPublishedIn.exec(line);
      if (!(matchPI === null)) {
        return {
          type: 'publishedIn',
          isInline: false,
          properties: {
            year: matchPI[2],
            context: '',
            type: 'publishedIn',
          } as ITypedLinkProperties,
          class: 'publishedIn',
        } as ITypedLink;
      }

      // Intuition: Start with the typed link prefix. Then a neo4j name (nameRegex).
      // Then one or more of the wikilink group: wikilink regex separated by optional comma and multiple spaces
      const regex = new RegExp(
          `^${this.regexEscape(this.settings.typedLinkPrefix)} (${nameRegex}) (${wikilinkRegex},? *)+$`);
      const match = regex.exec(line);
      if (!(match === null)) {
        return {
          type: match[1],
          isInline: false,
          properties: {
            context: '',
            type: match[1],
          },
          class: match[1],
        } as ITypedLink;
      }
      return null;
    }

    public async queryCreateRels(file: TFile, query: Query, queryMetadata: QueryMetadata, merge:boolean=false): Promise<Query> {
      const metadata = this.metadataCache.getFileCache(file);
      const content = (await this.vault.cachedRead(file)).split('\n');
      const srcVar = queryMetadata.nodeVars[file.basename];
      if (metadata) {
        const links = metadata.links;
        if (links === undefined) {
          return query;
        }
        links.forEach(async (link) => {
          let baseName = getLinkpath(link.link);//
          // Returns NULL for dangling notes!
          const trgtFile = this.metadataCache.getFirstLinkpathDest(baseName, file.path);

          if (trgtFile) {
            // This is an existing object.
            baseName = trgtFile.basename;
          }
          let trgtVar: string;
          if (baseName in queryMetadata.nodeVars) {
            trgtVar = queryMetadata.nodeVars[baseName];
          } else if (trgtFile && merge) {
            // When merging, there's likely no var created for this note yet.
            trgtVar = queryMetadata.nextNodeVar(baseName);
            query = query.match(this.node(trgtVar, baseName))
            ;
          } else {
            // This node hasn't been seen before, so we need to create it.
            // Creates dangling nodes if untyped, otherwise creates attachment nodes
            trgtVar = queryMetadata.nextNodeVar(baseName);
            const nodeDef = await this.createNode(trgtFile, baseName);
            if (merge) {
              query = query.merge(node(trgtVar, nodeDef.labels, nodeDef.properties))
              ;
            } else {
              query = query.createNode(trgtVar, nodeDef.labels, nodeDef.properties);
            }
          }
          const line = content[link.position.start.line];
          let typedLink = this.parseTypedLink(link, line);
          if (typedLink === null) {
            typedLink = {
              class: 'inline',
              isInline: true,
              properties: {
                context: line,
                type: '',

              },

            } as ITypedLink;
          }

          query = query.create([
            node(srcVar),
            relation('out', [typedLink.class], typedLink.properties),
            node(trgtVar)]);
          if (merge) {
            query.with(queryMetadata.values());
          }
        });

        return query;
      }
      console.log('File without metadata');
      console.log(file);
      return null;
    }

    async metadataCacheOnChanged(file: TAbstractFile) {
      // It's always called after the respective other events.
      // Note: This is NOT called on rename, unless there's a reflexive link to itself.
      // When a file is created, this is fired with an empty filecache. We synchronize the event firing,
      // so we let the create callback handle the creation of the node.

      console.log('changed metadata');
      console.log(file);
      const session = this.session();
      if (file instanceof TFile) {
        const name = file.basename;
        const queryMetadata = new QueryMetadata();
        const nodeVar = 'n0';
        // Find all labels on node
        const result = await this.runQuery(
            new Query().match(this.node(nodeVar, name)).return(nodeVar), session);
        const oldLabels = result.records[0].get(0).labels;

        if (oldLabels.length > 0) {
          console.log(oldLabels);
          // Remove all labels on node
          await this.runQuery(new Query().match(this.node(nodeVar, name))
          // @ts-ignore
              .removeLabels({n0: oldLabels}), session);
        }

        queryMetadata.nodeIndex = 1;
        queryMetadata.nodeVars[name] = nodeVar;
        let query = new Query().match(this.node(nodeVar, name));
        // Update node with new info
        query = await this.queryUpdateNote(file, query, queryMetadata);
        await this.executeQueries([query], session);
        // Delete all outgoing edges:
        const dRelQuery = new Query().match([
          this.node(nodeVar, name),
          relation('out', 'r'), node('plc')])
            .delete('r');
        await this.executeQueries([dRelQuery]);
        // Recreate relations, taking into account any changes
        const relQuery = await this.queryCreateRels(file, new Query().match(this.node(nodeVar, name)), queryMetadata, true);
        await this.executeQueries([relQuery.return(nodeVar)], session);
      }
      await session.close();
    }

    async vaultOnRename(file: TAbstractFile, oldPath: string) {
      // This is called BEFORE metadataCache vault change.
      // So if we just rename the neo4j node, it should be fine when rebuilding relations. But rebuilding relations
      // should happen before the rename event is resolved... Hopefully it works async
      console.log('onRename');

      if (file instanceof TFile) {
        const oldName = basename(oldPath, '.md');
        console.log(oldName);
        const query = new Query().match(this.node('n', oldName))
            .setValues({n: {name: file.basename}}, true);
        await this.executeQueries([query]);
      }
      this.lastFileEvent = 'rename';
    }

    async vaultOnModify(file: TAbstractFile) {
      // Called BEFORE metadataCache changed event.
      // At this point, the metadataCache HASN'T been updated yet!
      // It shouldn't be needed to do anything related with relation/tag updating here.
      // At most, we could update the content property of the node.
      this.lastFileEvent = 'modify';
      console.log('onModify');
    }

    async vaultOnDelete(file: TAbstractFile) {
      // After deleting, no metadatacache changed event is fired.
      // Note: MetadataCache event isn't called either for incoming edges
      this.lastFileEvent = 'delete';
      console.log('onDelete');

      const session = this.session();

      if (file instanceof TFile) {
        const name = file.basename;
        const result = await this.runQuery(new Query().match([
          this.node('n', name),
          relation('in'),
          node('m')]).return('n'), session,
        );
        console.log(result);
        if (result.records.length === 0) {
          // If there are no incoming links, detach delete the node
          await this.executeQueries([
            new Query().match(this.node('n', name))
                .detachDelete('n')], session);
        } else {
          // If there are any incoming links, change labels to dangling and empty properties
          const result = await this.runQuery(new Query()
              .match(this.node('n', name)).return('n'), session);
          // return query.setValues({}).removeLabels(dict);
          let query = new Query().match(this.node('n', name));
          const oldLabels = result.records[0].get(0).labels;
          if (oldLabels.length > 0) {
            query = query.removeLabels({n: oldLabels});
          }
          query = query.setLabels({n: CAT_DANGLING})
              .setValues({
                SMD_vault: this.vault.getName(),
                name: name,
              }, false);
          await this.executeQueries([query], session);
        }
      }
      await session.close();
    }

    async vaultOnCreate(file: TAbstractFile) {
      // This is called BEFORE metadataCache vault change.
      // Create the node as a blank state, then fill in later with on metadatacache changed etc.
      // Note: it's possible the node already exists as a dangling node. In that case, just do nothing
      // and let the metadatacache event handle it
      this.lastFileEvent = 'create';
      console.log('onCreate');
      const session = this.session();
      console.log('sess created');
      if (file instanceof TFile) {
        const name = file.basename;
        const result = await this.runQuery(new Query().match(this.node('n', name))
            .return('n'), session);
        console.log(result);
        if (result.records.length == 0) {
          // if not exists:
          await this.executeQueries([new Query().create(this.node('n', name))], session);
        }
      }
    }

    public async stop() {
      await this.driver.close();
    }
}
