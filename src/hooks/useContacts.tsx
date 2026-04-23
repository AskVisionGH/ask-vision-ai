import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface ContactRow {
  id: string;
  user_id: string;
  name: string;
  address: string;
  resolved_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactInput {
  name: string;
  address: string;
  resolved_address?: string | null;
}

/** Loads + manages the current user's saved wallet contacts. */
export const useContacts = () => {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setContacts([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .order("name", { ascending: true });
    if (!error && data) setContacts(data as ContactRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const addContact = useCallback(
    async (input: ContactInput): Promise<ContactRow | { error: string }> => {
      if (!user) return { error: "Not signed in" };
      const trimmed = {
        name: input.name.trim(),
        address: input.address.trim(),
        resolved_address: input.resolved_address?.trim() || null,
      };
      if (!trimmed.name) return { error: "Name required" };
      if (!trimmed.address) return { error: "Address required" };

      const { data, error } = await supabase
        .from("contacts")
        .insert({ ...trimmed, user_id: user.id })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") return { error: "You already have a contact with that name" };
        return { error: error.message };
      }
      setContacts((prev) =>
        [...prev, data as ContactRow].sort((a, b) => a.name.localeCompare(b.name)),
      );
      return data as ContactRow;
    },
    [user],
  );

  const updateContact = useCallback(
    async (id: string, patch: Partial<ContactInput>): Promise<boolean> => {
      const cleaned: Partial<ContactInput> = {};
      if (patch.name !== undefined) cleaned.name = patch.name.trim();
      if (patch.address !== undefined) cleaned.address = patch.address.trim();
      if (patch.resolved_address !== undefined)
        cleaned.resolved_address = patch.resolved_address?.trim() || null;

      const { data, error } = await supabase
        .from("contacts")
        .update(cleaned)
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) return false;
      setContacts((prev) =>
        prev
          .map((c) => (c.id === id ? (data as ContactRow) : c))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      return true;
    },
    [],
  );

  const deleteContact = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) return false;
    setContacts((prev) => prev.filter((c) => c.id !== id));
    return true;
  }, []);

  return { contacts, loading, refresh, addContact, updateContact, deleteContact };
};

/** Looks up a contact by case-insensitive name. */
export const findContactByName = (
  contacts: ContactRow[],
  name: string,
): ContactRow | null => {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return contacts.find((c) => c.name.toLowerCase() === needle) ?? null;
};

/** Looks up a contact by exact address (input or resolved). */
export const findContactByAddress = (
  contacts: ContactRow[],
  address: string,
): ContactRow | null => {
  const needle = address.trim();
  if (!needle) return null;
  return (
    contacts.find(
      (c) => c.address === needle || c.resolved_address === needle,
    ) ?? null
  );
};
