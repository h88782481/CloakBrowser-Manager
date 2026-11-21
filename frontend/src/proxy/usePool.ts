import { useCallback, useEffect, useState } from "react";
import { POOL_CHANGED, poolApi, type Catalog } from "./api";

export function usePool() {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener(POOL_CHANGED, reload);
    return () => window.removeEventListener(POOL_CHANGED, reload);
  }, [reload]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    poolApi.catalog(controller.signal).then((next) => {
      if (!controller.signal.aborted) setData(next);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load the proxy pool");
    });
    return () => controller.abort();
  }, [revision]);
  return { data, error, reload, revision };
}
