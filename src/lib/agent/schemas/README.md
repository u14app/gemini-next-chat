# Tool meta-schema

`draft7.json` is the JSON Schema Draft 7 meta-schema from
[json-schema.org](https://json-schema.org/draft-07/schema), also published in
the [specification repository](https://github.com/json-schema-org/json-schema-spec/blob/draft-07/schema.json).
Only formatting is changed. The upstream BSD 3-clause license is in
[`LICENSE`](./LICENSE).

The tool validator bundles this data to check runtime schemas without network
access or JavaScript code generation. It adds `$defs` and `nullable` support
to a private copy to preserve the application's existing validation behavior.
