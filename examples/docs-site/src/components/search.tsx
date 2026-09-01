/**
 * Search dialog wired to Graft: the fetch client hits /api/search, which is
 * Postgres FTS over content_index (weighted tsvectors, GIN) — the docs search
 * IS the product's search feature.
 *
 * The placeholder does not say so. It is the one line of copy whose job is to
 * tell someone what to type, and "Postgres FTS" answers a question nobody
 * standing in front of a search box is asking. The engine is a selling point
 * on /docs/search, where there is room to make the argument.
 */
import { useDocsSearch } from "fumadocs-core/search/client";
import { fetchClient } from "fumadocs-core/search/client/fetch";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";

export default function GraftSearchDialog(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    client: fetchClient({ api: "/api/search" }),
  });

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput placeholder="Search the docs…" />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== "empty" ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
