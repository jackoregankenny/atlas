import { useCallback, useEffect, useState } from "react";
import {
  addToCollection,
  createCollection,
  deleteCollection,
  listCollections,
  removeFromCollection,
  renameCollection,
} from "../api";
import type { Collection } from "../types";

export function useFolders() {
  const [folders, setFolders] = useState<Collection[]>([]);

  const refresh = useCallback(async () => {
    try {
      setFolders(await listCollections());
    } catch (e) {
      console.error("listCollections failed", e);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string) => {
      const id = await createCollection(name);
      await refresh();
      return id;
    },
    [refresh]
  );

  const rename = useCallback(
    async (id: number, name: string) => {
      await renameCollection(id, name);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: number) => {
      await deleteCollection(id);
      await refresh();
    },
    [refresh]
  );

  const addBook = useCallback(
    async (folderId: number, bookId: number) => {
      await addToCollection(folderId, bookId);
      await refresh();
    },
    [refresh]
  );

  const removeBook = useCallback(
    async (folderId: number, bookId: number) => {
      await removeFromCollection(folderId, bookId);
      await refresh();
    },
    [refresh]
  );

  return { folders, refresh, create, rename, remove, addBook, removeBook };
}
