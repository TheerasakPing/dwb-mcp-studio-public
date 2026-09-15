import { pathToFileURL } from 'node:url';
import type { LoadHook } from 'node:module';

const target = pathToFileURL(process.env.DWB_CONFIG_TARGET!).href;
export const load: LoadHook = async (url, context, nextLoad) => {
  const result = await nextLoad(url, context);
  if (url !== target) return result;
  const source =
    typeof result.source === 'string'
      ? result.source
      : Buffer.from(result.source as ArrayBuffer).toString('utf8');
  const original = 'export const USER_HOME = os.homedir();';
  const isolated = 'export const USER_HOME = process.env.DWB_DC_CONFIG_HOME || os.homedir();';
  if (!source.includes(original) && !source.includes(isolated))
    throw new Error('Cannot isolate Desktop Commander config: unsupported source layout.');
  return { ...result, source: source.replace(original, isolated) };
};
