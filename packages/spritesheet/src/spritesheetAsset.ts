import { copySearchParams, LoaderParserPriority } from '@pixi/assets';
import { extensions, ExtensionType, settings, utils } from '@pixi/core';
import { Spritesheet } from './Spritesheet';

import type { AssetExtension, Loader, ResolvedAsset, UnresolvedAsset } from '@pixi/assets';
import type { Texture } from '@pixi/core';
import type { ISpritesheetData } from './Spritesheet';

export interface SpriteSheetJson extends ISpritesheetData
{
    meta: {
        image: string;
        scale: string;
        // eslint-disable-next-line camelcase
        related_multi_packs?: string[];
    };
}

const validImages = ['jpg', 'png', 'jpeg', 'avif', 'webp'];

function getCacheableAssets(keys: string[], asset: Spritesheet, ignoreMultiPack: boolean)
{
    const out: Record<string, Texture | Spritesheet> = {};

    keys.forEach((key: string) =>
    {
        out[key] = asset;
    });

    Object.keys(asset.textures).forEach((key) =>
    {
        out[`${asset.cachePrefix}${key}`] = asset.textures[key];
    });

    if (!ignoreMultiPack)
    {
        const basePath = utils.path.dirname(keys[0]);

        asset.linkedSheets.forEach((item: Spritesheet, i) =>
        {
            Object.assign(out, getCacheableAssets(
                [`${basePath}/${asset.data.meta.related_multi_packs[i]}`],
                item,
                true
            ));
        });
    }

    return out;
}

/**
 * Asset extension for loading spritesheets.
 * @memberof PIXI
 * @type {PIXI.AssetExtension}
 */
export const spritesheetAsset = {
    extension: ExtensionType.Asset,
    /** Handle the caching of the related Spritesheet Textures */
    cache: {
        test: (asset: Spritesheet) => asset instanceof Spritesheet,
        getCacheableAssets: (keys: string[], asset: Spritesheet) => getCacheableAssets(keys, asset, false),
    },
    /** Resolve the the resolution of the asset. */
    resolver: {
        test: (value: string): boolean =>
        {
            const tempURL = value.split('?')[0];
            const split = tempURL.split('.');
            const extension = split.pop();
            const format = split.pop();

            return extension === 'json' && validImages.includes(format);
        },
        parse: (value: string): UnresolvedAsset =>
        {
            const split = value.split('.');

            return {
                resolution: parseFloat(settings.RETINA_PREFIX.exec(value)?.[1] ?? '1'),
                format: split[split.length - 2],
                src: value,
            };
        },
    },
    /**
     * Loader plugin that parses sprite sheets!
     * once the JSON has been loaded this checks to see if the JSON is spritesheet data.
     * If it is, we load the spritesheets image and parse the data into PIXI.Spritesheet
     * All textures in the sprite sheet are then added to the cache
     * @ignore
     */
    loader: {
        name: 'spritesheetLoader',

        extension: {
            type: ExtensionType.LoadParser,
            priority: LoaderParserPriority.Normal,
        },

        async testParse(asset: SpriteSheetJson, options: ResolvedAsset): Promise<boolean>
        {
            return (utils.path.extname(options.src).toLowerCase() === '.json' && !!asset.frames);
        },

        async parse(asset: SpriteSheetJson, options: ResolvedAsset, loader: Loader): Promise<Spritesheet>
        {
            const {
                texture: imageTexture, // if user need to use preloaded texture
                imageFilename, // if user need to use custom filename (not from jsonFile.meta.image)
                cachePrefix, // if user need to use custom cache prefix
            } = options?.data ?? {};

            let basePath = utils.path.dirname(options.src);

            if (basePath && basePath.lastIndexOf('/') !== (basePath.length - 1))
            {
                basePath += '/';
            }

            let texture: Texture;

            if (imageTexture && imageTexture.baseTexture)
            {
                texture = imageTexture;
            }
            else
            {
                const imagePath = copySearchParams(basePath + (imageFilename ?? asset.meta.image), options.src);

                const assets = await loader.load<Texture>([imagePath]);

                texture = assets[imagePath];
            }

            const spritesheet = new Spritesheet({
                texture: texture.baseTexture,
                data: asset,
                resolutionFilename: options.src,
                cachePrefix,
            });

            await spritesheet.parse();

            // Check and add the multi atlas
            // Heavily influenced and based on https://github.com/rocket-ua/pixi-tps-loader/blob/master/src/ResourceLoader.js
            // eslint-disable-next-line camelcase
            const multiPacks = asset?.meta?.related_multi_packs;

            if (Array.isArray(multiPacks))
            {
                const promises: Promise<Spritesheet<SpriteSheetJson>>[] = [];

                for (const item of multiPacks)
                {
                    if (typeof item !== 'string')
                    {
                        continue;
                    }

                    let itemUrl = basePath + item;

                    // Check if the file wasn't already added as multipack
                    if (options.data?.ignoreMultiPack)
                    {
                        continue;
                    }

                    itemUrl = copySearchParams(itemUrl, options.src);

                    promises.push(loader.load<Spritesheet<SpriteSheetJson>>({
                        src: itemUrl,
                        data: {
                            ignoreMultiPack: true,
                        }
                    }));
                }

                const res = await Promise.all(promises);

                spritesheet.linkedSheets = res;
                res.forEach((item) =>
                {
                    item.linkedSheets = [spritesheet].concat(spritesheet.linkedSheets.filter((sp) => (sp !== item)));
                });
            }

            return spritesheet;
        },

        unload(spritesheet: Spritesheet)
        {
            spritesheet.destroy(true);
        },
    },
} as AssetExtension<Spritesheet | SpriteSheetJson>;

extensions.add(spritesheetAsset);
