# Interface system

`controls.css` defines shared field geometry, state colors, touch targets and dialog layout. It loads after feature styles; `navigation.css` loads last to own viewport offsets. Use native form controls with associated labels. Financial amount fields inside `.input-wrap` have larger numeric typography through field variables; ordinary fields remain 16px on mobile to avoid input zoom.

`installControls()` progressively enhances single-select fields with a select-only combobox. The native select remains the form value and validation source. Options use textContent, not HTML. Pointer selection, arrow keys, Home/End, type-ahead, Enter, Escape and Tab are supported. Popovers float above dialogs, choose the available side of the field, and close on outside focus, scrolling, resizing or dialog dismissal. Browsers without the Popover API keep styled native selects. Multiple/listbox selects and `data-native` selects are left native.

Dynamic option markup, disabled states, required fields and validation attributes are observed. Dispatch a `change` event after changing a select's value programmatically. Do not find submit actions with `form.querySelector('button')`: enhanced selects contain non-submit buttons. Use an explicit submit selector or stable action hook.

## Scrolling decisions

| Surface | Desktop | Mobile |
| --- | --- | --- |
| App navigation | Sticky compact header | Sticky identity/actions; bottom navigation with safe areas |
| Portfolio | Sticky holdings rail; bounded list; planner identity retained | One document scroll; horizontal holdings; target dock only within the active planner when the full target is offscreen |
| Research | Sticky tab rail and active ticker; bounded source sidebar | Compact sticky tab rail; content scrolls in the document |
| Strategies | Parameters and charts scroll together | Two-column inputs; full-width Compare action |
| Markets | Sticky category rail; selected chart stays beside the indicator list on wide, tall screens | Categories stay accessible; chart and indicators share document scroll |
| Studio | Article rail and writing actions stay accessible; article text expands | Horizontal article picker; content and writing actions scroll with the document |
| Settings / Owner | Document scroll; long ledgers scroll inside a bounded table with retained headings | Document scroll; tables retain horizontal exploration |
| Public article | Compact reading bar; bounded section rail | Reading bar; section links scroll horizontally in normal flow |
| Dialogs | Fixed title/close controls; content scrolls inside; action row retained | Same structure, sized to the dynamic viewport |

Short viewports release secondary sticky surfaces. The on-screen keyboard suppresses bottom navigation and target dock. Reduced-motion preferences disable decorative transitions. Scroll offsets account for retained navigation so focused fields and anchors remain visible.

## Verification

Exercise settings changes, dependent model menus, asset entry, strategy currency changes and modal dropdowns after changing shared controls. Check 320px/390px mobile and desktop widths, keyboard selection and Escape, long content, form submission, viewport resizing and route changes. Use synthetic local data for edits and publication previews.
