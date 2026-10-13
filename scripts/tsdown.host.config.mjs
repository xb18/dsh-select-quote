/**
 * 宿主侧（Node）half 的打包配置。
 *
 * 与根目录的客户端配置 `tsdown.config.ts` 分开：客户端要打成 CJS 工厂再塞进
 * `__ModuleLoader__.load`，宿主侧则要输出原生 ESM 供 Node 直接 import，两者的
 * format / platform / external 完全不同，混在一个配置里只会互相污染。
 *
 * 放在 scripts/ 下而不是仓库根目录，是为了不往包根再添一个构建产物配置文件：
 * 该目录已经承载全部构建脚本。代价是 tsdown 以本文件所在目录为基准解析 `entry`
 * （实测写成 'src/host/index.ts' 会报 UNRESOLVED_ENTRY），因此这里用相对路径
 * 指回仓库根下的源码。
 */
/** @type {import('tsdown').UserConfig} */
export default {
  entry: ['../src/host/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: false,
  clean: true,
  deps: { neverBundle: ['@deepseek-ai/cordis'] },
}
