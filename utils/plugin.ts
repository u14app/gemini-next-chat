import { FunctionDeclaration, SchemaType } from '@xiangfa/generative-ai'
import type { FunctionDeclarationSchema, FunctionDeclarationSchemaProperty, Schema } from '@xiangfa/generative-ai'
import { entries, values, isString, isArray, isObject } from 'lodash-es'

export function findOperationById(plugin: OpenAPIDocument, id: string) {
  for (const [path, operations] of entries(plugin.paths)) {
    for (const [method, operation] of entries(operations) as [string, OpenAPIOperation][]) {
      if (operation?.operationId === id) {
        return { ...operation, path, method }
      }
    }
  }
}

function filterProperties(properties: FunctionDeclarationSchemaProperty) {
  const schemaProperties: any = { type: SchemaType.OBJECT }
  for (const [key, value] of entries(properties)) {
    if (key === 'type') {
      if (isString(value) && values(['string', 'number', 'integer', 'boolean', 'array', 'object']).includes(value)) {
        schemaProperties.type = value as SchemaType
      }
    } else if (key === 'description') {
      if (isString(value)) {
        schemaProperties.description = value
      }
    } else if (key === 'items') {
      if (isObject(value)) {
        schemaProperties.items = filterProperties(value as FunctionDeclarationSchemaProperty)
      }
    } else if (key === 'anyOf' || key === 'allOf' || key === 'oneOf') {
      if (isArray(value)) {
        let props: Record<string, Schema> = {}
        for (const item of value) {
          for (const [k, v] of entries(item.properties as FunctionDeclarationSchemaProperty)) {
            props[k] = filterProperties(v)
          }
        }
        schemaProperties.properties = props
      }
    } else if (key === 'properties') {
      if (isObject(value)) {
        const props: Record<string, Schema> = {}
        for (const [k, v] of entries(value)) {
          props[k] = filterProperties(v)
        }
        schemaProperties.properties = props
      }
    } else if (key === 'enum') {
      if (isArray(value) && value.every((item) => isString(item))) {
        schemaProperties.enum = value
      }
    } else if (key === 'required') {
      if (isArray(value) && value.every((item) => isString(item))) {
        schemaProperties.required = value
      }
    } else if (key === 'example') {
      schemaProperties.example = value
    }
  }
  return schemaProperties
}

function convertOpenAPIParameter(parameters: OpenAPIParameter[]): FunctionDeclarationSchema {
  const functionSchema: FunctionDeclarationSchema = { type: SchemaType.OBJECT, properties: {} }
  let properties: Record<string, FunctionDeclarationSchemaProperty> = {}
  let required: string[] = []
  for (const parameter of parameters) {
    let props: any = {}
    if (parameter.schema) {
      const schema = filterProperties(parameter.schema as FunctionDeclarationSchemaProperty)
      props = { ...schema }
    }
    if (parameter.required) required.push(parameter.name)
    if (parameter.description) props.description = parameter.description
    properties[parameter.name] = props
  }
  functionSchema.properties = properties
  if (required.length > 0) functionSchema.required = required
  return functionSchema
}

export function convertRequestBodyToSchema(requestBody: OpenAPIRequestBody) {
  if (!requestBody || !requestBody.content) {
    return null
  }
  let parametersSchemas = {}
  for (const [contentType, mediaType] of Object.entries(requestBody.content)) {
    if (mediaType.schema) {
      const functionSchema = filterProperties(mediaType.schema)
      parametersSchemas = { ...parametersSchemas, ...functionSchema }
    }
  }
  return parametersSchemas as FunctionDeclarationSchema
}

export function parsePlugin(id: string, plugin: OpenAPIDocument): FunctionDeclaration[] {
  const tools: FunctionDeclaration[] = []
  for (const operations of values(plugin.paths)) {
    for (const operation of values(operations) as OpenAPIOperation[]) {
      let parameters
      if (operation.parameters) {
        parameters = convertOpenAPIParameter(operation.parameters as OpenAPIParameter[])
      } else if (operation.requestBody) {
        parameters = convertRequestBodyToSchema(operation.requestBody as OpenAPIRequestBody)
      }
      if (parameters) {
        tools.push({
          name: `${id}__${operation.operationId}`,
          description: operation.summary || operation.description || operation.operationId,
          parameters,
        })
      }
    }
  }
  return tools
}

export function parseSpiceBody(body: any, regex = /^ddg_spice_[\w]+\(\n?((?:.|\n)+)\n?\);?/) {
  return JSON.parse(regex.exec(body.toString())![1])
}
