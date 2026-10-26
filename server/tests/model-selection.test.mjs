import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const saved = new Map();
globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
globalThis.window = { localStorage: globalThis.localStorage };
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { defaultConfig, useConfigStore, resolveModelRequestConfig, resolveConfiguredModel } = await vite.ssrLoadModule('/src/stores/use-config-store.ts');
test.after(async () => { await vite.close(); delete globalThis.localStorage; delete globalThis.window; });

test('legacy default and local choices retain identity, unavailable defaults are preserved but cannot run', () => {
    useConfigStore.setState({ config: { ...defaultConfig, textModel: 'backend::gpt-old' } });
    useConfigStore.getState().syncApiModels({ text: { models: ['provider-text-new'] }, image: { models: ['provider-image'] } });
    let config = useConfigStore.getState().config;
    assert.equal(config.textModel, 'text-default::gpt-old');
    assert.equal(config.imageModel, '');
    assert.deepEqual(config.textModels, ['text-default::provider-text-new']);
    assert.throws(() => resolveModelRequestConfig(config, config.textModel), /重新选择/);
    assert.equal(resolveConfiguredModel(config, 'text', 'backend::provider-text-new'), 'text-default::provider-text-new');
    useConfigStore.getState().updateConfig('textModel', 'text-default::provider-text-new');
    useConfigStore.getState().syncApiModels({ text: { models: ['provider-text-new', 'provider-another'] } });
    config = useConfigStore.getState().config;
    assert.equal(config.textModel, 'text-default::provider-text-new');
    assert.equal(resolveModelRequestConfig(config, config.textModel).model, 'provider-text-new');
    useConfigStore.getState().syncApiModels({ text: { models: [] } });
    config = useConfigStore.getState().config;
    assert.equal(config.textModel, 'text-default::provider-text-new');
    assert.deepEqual(config.models, []);
    assert.throws(() => resolveModelRequestConfig(config, config.textModel), /重新选择/);
});

test('same model across channels has independent identity, deleted channel never falls back, reload retains protocols', async () => {
    useConfigStore.getState().syncApiModels({ text: { models: [], channels: [
        {id:'channel-a',name:'A',models:['shared'],apiFormat:'openai',textProtocol:'chat'},
        {id:'channel-b',name:'B',models:['shared'],apiFormat:'openai',textProtocol:'responses'},
    ] } });
    const config=useConfigStore.getState().config;
    assert.deepEqual(config.textModels,['channel-a::shared','channel-b::shared']);
    assert.equal(resolveModelRequestConfig(config,'channel-a::shared').baseUrl,'/api/ai/channels/channel-a');
    assert.equal(resolveModelRequestConfig(config,'channel-a::shared').textProtocol,'chat');
    assert.throws(()=>resolveModelRequestConfig(config,'deleted::shared'),/重新选择/);
    assert.equal(useConfigStore.getState().isAiConfigReady(config,'deleted::shared'),false);
    useConfigStore.getState().saveDefaultModels({...config,textModel:'channel-a::shared'});
    await useConfigStore.persist.rehydrate();
    const restored=useConfigStore.getState().config;
    assert.equal(restored.textModel,'channel-a::shared');
    assert.equal(resolveModelRequestConfig(restored,restored.textModel).textProtocol,'chat');
    assert.equal(restored.channels.find(c=>c.id==='channel-b').textProtocol,'responses');
});

test('no built-in defaults on clean install; image default alias stays synchronized', () => {
    assert.deepEqual(defaultConfig.models, []);
    assert.equal(defaultConfig.textModel, '');
    useConfigStore.getState().syncApiModels({ image: { models: ['provider-image'] } });
    useConfigStore.getState().updateConfig('imageModel', 'image-default::provider-image');
    assert.equal(useConfigStore.getState().config.model, 'image-default::provider-image');
    assert.equal(useConfigStore.getState().isAiConfigReady(useConfigStore.getState().config, 'backend::gone'), false);
});
