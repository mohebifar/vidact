import { enableDomForms as enableBuiltDomForms } from '@vidact/runtime/dom/forms'
import { enableDomNamespace as enableBuiltDomNamespace } from '@vidact/runtime/dom/namespace'
import { enableDomStyles as enableBuiltDomStyles } from '@vidact/runtime/dom/styles'

import { enableDomForms } from '../src/dom-forms.ts'
import { enableDomStyles } from '../src/dom-styles.ts'
import { enableDomNamespace } from '../src/dom/namespace.ts'

enableDomForms()
enableDomNamespace()
enableDomStyles()
enableBuiltDomForms()
enableBuiltDomNamespace()
enableBuiltDomStyles()
