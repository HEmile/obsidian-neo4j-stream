import type {Vault} from 'obsidian';


export const STATUS_OFFLINE = 'Neo4j stream offline';
export const DATA_FOLDER = function(vault: Vault) {
  return `${vault.configDir}/plugins/juggl/`;
};
