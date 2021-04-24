import typescript from '@rollup/plugin-typescript';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';


export default {
  input: 'main.ts',
  output: {
    dir: '.',
    sourcemap: 'inline',
    format: 'cjs',
    exports: 'default',
    // banner: '/* This file is bundled with rollup. For the source code, see Github */',
  },
  external: ['obsidian'],
  plugins: [
    commonjs({
      include: ['node_modules/**'],
    }),
    typescript({sourceMap: true}),
    nodeResolve({browser: true}),
    copy({
      targets: [
        {src: 'main.js', dest: '../../juggl/docs/.obsidian/plugins/neo4j-stream'},
        {src: 'styles.css', dest: '../../juggl/docs/.obsidian/plugins/neo4j-stream'},
      ],
      hook: 'writeBundle',
    }),
  ],
};
