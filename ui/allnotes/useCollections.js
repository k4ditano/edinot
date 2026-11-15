// Colecciones del vault activo como estado de React (se actualizan al cambiar el Y.Map).
import { useEffect, useMemo, useState, useCallback } from 'react';
import { getCollections, saveCollection, deleteCollection, observeCollections } from '../../store.js';

export function useCollections(vaultId) {
  const [v, setV] = useState(0);
  useEffect(() => observeCollections(vaultId, () => setV(x => x + 1)), [vaultId]);
  const list = useMemo(() => getCollections(vaultId), [vaultId, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useCallback((col) => saveCollection(vaultId, col), [vaultId]);
  const remove = useCallback((id) => deleteCollection(vaultId, id), [vaultId]);
  return { collections: list, saveCollection: save, deleteCollection: remove };
}
