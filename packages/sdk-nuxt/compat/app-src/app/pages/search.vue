<!-- The Nuxt guide's list-and-search page, as written there, so its build and typecheck run here. -->
<script setup lang="ts">
const { data: pages } = await useGraftList("pages");
const query = ref("");
const { data: hits } = await useGraftSearch("pages", query);
</script>

<template>
  <input v-model="query" placeholder="Search" />
  <ul>
    <li v-for="page in query ? (hits ?? []) : (pages ?? [])" :key="page.slug">
      <NuxtLink :to="`/${page.slug}`">{{ page.data.title }}</NuxtLink>
    </li>
  </ul>
</template>
