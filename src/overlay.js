import fs from 'fs'
import { JSONPath } from 'jsonpath-plus'
import { safeStringify, parseWithPointers } from '@stoplight/yaml'
import mergician from 'mergician'

function applyOverlayToOpenAPI (spec, overlay) {
  if (overlay.actions && overlay.actions.length >= 1) {
    overlay.actions.forEach((a) => {
      // Is it a remove?
      if (Object.prototype.hasOwnProperty.call(a, 'remove')) {
        // Collect every match with its parent + the key/index that reaches it.
        const matches = JSONPath({ path: a.target, json: spec, resultType: 'all' })
        // Delete array elements high-index-first so earlier splices don't shift
        // the indexes of matches we still have to remove.
        const arrayDeletions = []
        matches.forEach((m) => {
          if (Array.isArray(m.parent)) {
            arrayDeletions.push({ parent: m.parent, index: Number(m.parentProperty) })
          } else if (m.parent) {
            delete m.parent[m.parentProperty]
          }
        })
        arrayDeletions
          .sort((x, y) => y.index - x.index)
          .forEach((d) => d.parent.splice(d.index, 1))
      } else {
        try {
          // It must be an update
          if (a.target === '$') {
            spec = merger(a.update)(spec)
          } else {
            JSONPath({
              path: a.target,
              json: spec,
              resultType: 'all',
              callback: (m) => {
                if (m.parent) {
                  m.parent[m.parentProperty] = merger(a.update)(m.value)
                }
              }
            })
          }
        } catch (ex) {
          process.stderr.write(`Error applying overlay: ${ex.message}\n`)
        }
      }
    })
  }

  return spec
}

// Deep merge using a module (built-in spread operator is only shallow)
function merger (obj) {
  return (chunk) => {
    return mergician({ appendArrays: true })(chunk, obj)
  }
}

function sortOpenAPIFields (field1, field2) {
  const orderedKeys = ['info', 'servers', 'summary', 'operationId', 'tags', 'paths', 'components', 'description', 'parameters', 'responses']

  const index1 = orderedKeys.indexOf(field1)
  const index2 = orderedKeys.indexOf(field2)

  if (index1 === -1 || index2 === -1) {
    return 0
  } else if (index1 > index2) {
    return 1
  } else {
    return -1
  }
}

export function applyOverlay (definition, overlay) {
  return applyOverlayToOpenAPI(definition, overlay)
}

export function overlayFiles (openapiFile, overlayFile) {
  // Parse the "input" OpenAPI document
  const specraw = fs.readFileSync(openapiFile, 'utf8')
  let spec = parseWithPointers(specraw).data

  // Parse the "overlay" document
  const overlayraw = fs.readFileSync(overlayFile, 'utf8')
  const overlay = parseWithPointers(overlayraw).data

  spec = applyOverlayToOpenAPI(spec, overlay)

  // Return the new spec
  return safeStringify(spec, { sortKeys: sortOpenAPIFields })
}
