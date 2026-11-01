<script setup lang="ts">
const route = useRoute();
const slug = () => String(route.params.slug);
const { data: page } = await useGraftContent("pages", slug);
if (!page.value) throw createError({ statusCode: 404, statusMessage: "No such page" });
const { data: mdx } = await useFetch(() => `/api/mdx/${slug()}`);
</script>

<template>
  <main v-if="page">
    <h1>{{ page.data.title }}</h1>
    <p class="summary">{{ page.data.summary }}</p>
    <GraftMdx v-if="mdx" :code="mdx.code" />
    <NuxtLink id="to-about" to="/about">About</NuxtLink>
    <NuxtLink id="to-home" to="/home">Home</NuxtLink>
  </main>
</template>
