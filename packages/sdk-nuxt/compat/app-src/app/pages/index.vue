<script setup lang="ts">
const { data: pages } = await useGraftList("pages");
const query = ref("navigation");
const { data: hits } = await useGraftSearch("pages", query);
</script>

<template>
  <main>
    <h1>Pages</h1>
    <ul>
      <li v-for="page in pages ?? []" :key="page.slug">
        <NuxtLink :to="`/${page.slug}`">{{ page.data.title }}</NuxtLink>
      </li>
    </ul>
    <p id="hits">hits:{{ (hits ?? []).map((hit) => hit.slug).join(",") }}</p>
  </main>
</template>
