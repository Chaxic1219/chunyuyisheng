/** 同步自定义 tabBar 选中态与长辈模式字号 */
export function syncCustomTabBar(selected: number) {
  try {
    const pages = getCurrentPages();
    const page = pages[pages.length - 1] as {
      getTabBar?: () => {
        setData?: (data: Record<string, unknown>) => void;
        selected?: number;
        elder?: boolean;
      } | null;
    };
    const bar = typeof page?.getTabBar === "function" ? page.getTabBar() : null;
    if (!bar) return;

    let elder = false;
    try {
      elder = uni.getStorageSync("elderMode") === "1";
    } catch {
      elder = false;
    }

    if (typeof bar.setData === "function") {
      bar.setData({ selected, elder });
      return;
    }
    bar.selected = selected;
    bar.elder = elder;
  } catch {
    /* 非 tab 页或旧基础库忽略 */
  }
}
