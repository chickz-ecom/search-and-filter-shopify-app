// Deep link theme editor (docs/shopify-api/config-extensions.md mục 4 "Deep links").
// Block: addAppBlockId={api_key}/{handle}&target=… (đã xác nhận). Embed: context=apps&activateAppId=…
// VERIFY: tham số activateAppId nhận {api_key}/{handle} hay {extension uuid}/{handle} — HUMAN_TODO C5.

export type ThemeLinks = {
  embed: string;
  searchBlock: string;
  collectionBlock: string;
  editor: string;
};

export function themeEditorLinks(
  shopDomain: string,
  apiKey: string,
  extensionId?: string,
): ThemeLinks {
  const base = `https://${shopDomain}/admin/themes/current/editor`;
  const embedId = extensionId || apiKey;
  return {
    editor: base,
    embed: `${base}?context=apps&template=index&activateAppId=${encodeURIComponent(embedId)}/app-embed`,
    searchBlock: `${base}?template=search&addAppBlockId=${encodeURIComponent(apiKey)}/search-results&target=mainSection`,
    collectionBlock: `${base}?template=collection&addAppBlockId=${encodeURIComponent(apiKey)}/collection-filter&target=mainSection`,
  };
}

/** Kiểu activation từ shopify.app.extensions() (app-bridge-types: ThemeExtensionActivation, không export tên). */
export type ThemeBlockActivation = {
  handle: string;
  name: string;
  target: "section" | "content" | "head" | "body" | "compliance_head";
  status: "active" | "available" | "unavailable";
  activations: { target: string; themeId: string }[];
};

export type EmbedStatus = {
  embedEnabled: boolean;
  searchBlockAdded: boolean;
  collectionBlockAdded: boolean;
};

/** Đọc trạng thái embed/block của theme đang publish (BFS: Home hiển thị trạng thái embed). */
export function embedStatusFrom(extensions: { type: string; activations: unknown }[]): EmbedStatus {
  const blocks = extensions
    .filter((e) => e.type === "theme_app_extension")
    .flatMap((e) => (e.activations as ThemeBlockActivation[]) ?? []);
  const placed = (handle: string) =>
    blocks.some((b) => b.handle === handle && (b.activations?.length ?? 0) > 0);
  return {
    embedEnabled: blocks.some((b) => b.handle === "app-embed" && b.status === "active"),
    searchBlockAdded: placed("search-results"),
    collectionBlockAdded: placed("collection-filter"),
  };
}
