import { useEffect } from "react";

const DEFAULT_BRAND = "Mikiko CC";

export function usePageTitle(title: string, brand = DEFAULT_BRAND) {
  useEffect(() => {
    document.title = `${title} | ${brand}`;
  }, [brand, title]);
}
