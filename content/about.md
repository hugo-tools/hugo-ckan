---
title: About
---
This site is a **static snapshot** of a CKAN open data portal, rendered by
[Hugo](https://gohugo.io). There is no database or application server: every
dataset, resource, organization, group and facet page is a pre-built HTML file.

- **Search and faceting** run in your browser against `/index.json`.
- **Data previews** fetch resource files directly from their original URLs.
- **Machine-readable metadata** is published as static JSON: append `index.json`
  to any dataset or resource URL, or use the read-only endpoints under
  `/api/3/action/`, which mirror the CKAN Action API's response format.
