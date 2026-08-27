# DOM Observer Engine

DVE — DOM Visual Engine

Build the complete DVE (DOM Visual Engine) as a reusable, framework-independent browser inspection and interaction engine.

CRITICAL PRIORITY

The most important part of this project is the engine underneath the interface.

Do NOT optimize for a pretty dashboard.

Do NOT create a toy implementation.

Do NOT create simulated functionality.

Do NOT create fake browser behavior.

Every engine capability must be real, deterministic, testable, reusable, and suitable for integration into another application.

The Control Console and test pages exist only to expose and validate the actual engine.

1. WHAT DVE IS

DVE is a browser intelligence and interaction engine.

It sits between an external controller and a web application.

External Controller
        ↓
       DVE
        ↓
    Web Browser
        ↓
 Web Application


DVE:

observes web interfaces

builds a structured representation of the interface

answers precise queries

understands element geometry

detects interface changes

performs explicit browser actions

reports results

DVE does NOT:

contain an LLM

reason about user intent

decide what task should be performed

autonomously choose actions

The external controller decides.

DVE observes and executes.

2. CORE LOOP

DVE must support this operating model:

Controller
    ↓
observe/request information
    ↓
DVE
    ↓
minimal structured result
    ↓
Controller decides
    ↓
DVE action
    ↓
Browser
    ↓
DVE observes result/change
    ↓
Controller


The controller may repeat this loop indefinitely.

3. FRAMEWORK INDEPENDENCE

DVE must work against arbitrary web applications.

Test against:

Plain HTML

Vue

React

Next.js

Angular

Svelte

TanStack

dynamically rendered applications

DVE must not depend on the framework used by the target application.

4. BROWSER TECHNOLOGY

Use mature browser technologies instead of rebuilding browser functionality.

Evaluate and leverage:

Playwright

Chrome DevTools Protocol

DOM APIs

Accessibility APIs

MutationObserver

ResizeObserver

IntersectionObserver

browser geometry APIs

The engine-specific abstraction must be custom-built.

The architecture must support an existing installed Chrome browser during development.

Do not require bundled Chromium when unnecessary.

5. PAGE REPRESENTATION

DVE must maintain an internal structured representation of the current page.

The representation should understand:

DOM hierarchy

semantic roles

accessible names

text

labels

attributes

visibility

enabled/disabled state

coordinates

dimensions

viewport relationship

parent/child relationships

forms

buttons

links

inputs

selects

checkboxes

radio buttons

tables

lists

menus

dialogs

modals

toasts

dynamically inserted content

iframe boundaries

shadow DOM where accessible

Do not expose the entire DOM to external controllers.

6. QUERY ENGINE

External controllers must request only the information they need.

Examples:

buttons
inputs
links
forms
dialogs
modals
toasts
visible buttons
interactive elements
buttons in top 50% of viewport
buttons in bottom 30%
elements containing "Student"
elements near X
elements below X
elements above X
elements beside X
children of X
details of X


Support geometry-aware queries.

The query engine must be efficient and avoid unnecessary DOM traversal.

7. ELEMENT REFERENCES

Expose stable DVE element identifiers.

Example:

{
  "id": "dve_8f21",
  "type": "button",
  "role": "button",
  "name": "Add Student",
  "visible": true,
  "enabled": true,
  "bounds": {
    "x": 820,
    "y": 120,
    "width": 140,
    "height": 40
  }
}


References must be validated before actions.

Detect stale references safely.

8. ACTION ENGINE

DVE must support real browser actions:

click

double click

right click where appropriate

mouse movement

hover

type

clear

select

check

uncheck

focus

keyboard press

scroll

scrollTo

navigation

waiting for conditions

Actions must operate against real browser state.

9. HUMAN-OBSERVABLE MOUSE

DVE must support a visual mouse cursor.

There are two synchronized concepts:

Actual browser mouse

The real Playwright/CDP mouse controlling the page.

Visual mouse

A visible cursor rendered over the controlled page.

They must share the same coordinate system.

The visual mouse must support:

smooth movement

medium-fast realistic speed

configurable speed

hover visualization

click visualization

double-click visualization

movement tracking

Example:

visualMouse: true
speed: medium-fast


The visual mouse must be optional so production automation can disable rendering when unnecessary.

10. TYPING

Typing must be performed at a reasonable configurable speed rather than always inserting text instantaneously.

Support:

typing speed
typing delay
focus
clear
type


The engine must verify that the intended element actually has focus before typing where appropriate.

11. FOCUS MANAGEMENT

DVE must understand and expose focus changes.

Support:

focusing elements

detecting active element

keyboard navigation

focus changes caused by actions

focus inside dialogs/modals

focus inside iframes where accessible

12. MODALS AND TOASTS

DVE must detect interface overlays such as:

modal dialogs

confirmation dialogs

notification toasts

alerts

banners

temporary overlays

The engine should expose their:

type

text

position

visibility

interactive elements

lifecycle/change state

13. PAGE RESIZING

DVE must continuously maintain accurate geometry.

When:

viewport size changes

browser size changes

page layout changes

sidebar opens/closes

modal appears

content changes

responsive layout changes

DVE must automatically invalidate/recalculate affected geometry.

Do not rely on permanently cached coordinates.

14. RESOURCE EFFICIENCY

This is extremely important.

DVE should consume as few resources as reasonably possible.

Avoid:

continuous full DOM scans

unnecessary screenshots

unnecessary polling

unnecessary browser evaluations

sending unchanged information

rebuilding the entire page map after every action

Prefer:

event-driven updates

incremental updates

MutationObserver

ResizeObserver

targeted rescans

cached representations

geometry invalidation

change deltas

The engine should only perform expensive work when required.

15. VISUAL HIGHLIGHTING

DVE must be able to visually highlight elements by injecting temporary CSS/overlay markers.

Examples:

highlight element
highlight matching elements
highlight query results
remove highlights


The highlighting system must operate inside the appropriate page/frame context.

It must never permanently modify the target application.

16. ISOLATED EXECUTION ENVIRONMENT

Target pages must be loaded in an isolated controlled browser environment.

The architecture must ensure that DVE's injected:

CSS

visual mouse

overlays

inspection helpers

instrumentation

cannot accidentally affect unrelated pages or applications.

Treat every controlled browser/page/frame as an isolated execution context.

Do not assume the target application will be cooperative.

17. IFRAME SUPPORT

DVE must understand iframe boundaries.

Where browser security permits access:

inspect iframe documents

inspect elements

calculate frame-relative and page-relative geometry

execute actions

inject temporary visual overlays

Where browser security prevents access:

report the boundary clearly

do not attempt to bypass browser security

The architecture must remain compatible with real-world cross-origin applications.

18. CONTROL CONSOLE

Create ONE internal development page connected to the real DVE engine.

This is not the product itself.

It is an engineering control console.

Layout:

┌──────────────────────────────────────────────┐
│ URL SEARCH BAR                               │
├──────────────────────────────────────────────┤
│                                              │
│              TARGET PAGE                     │
│              ~80% WIDTH                      │
│                                              │
│                                              │
├───────────────────────────────┬──────────────┤
│                               │              │
│                               │ Widget list  │
│                               │ + controls   │
│                               │ ~20% width   │
│                               │              │
└───────────────────────────────┴──────────────┘


The right panel must be expandable to approximately 40% width.

The target page should occupy approximately 80% by default.

19. URL SEARCH BAR

The console must provide a URL input.

A developer can enter an arbitrary URL and load it into the controlled environment.

The engine must then inspect the loaded page.

Do not hard-code the test pages.

20. ELEMENT/WIDGET INSPECTOR

The right panel must show DVE-discovered elements/widgets.

Selecting one should reveal:

DVE ID

element type

role

accessible name

text

bounds

visibility

enabled state

attributes

parent

children

frame

current state

The information must come from the actual engine.

21. DIRECT DVE CONTROLS

From the console developers should be able to issue real commands:

observe buttons
observe inputs
observe modals
observe toasts
observe buttons in top 50%
get element X
move to X
click X
doubleClick X
type X
scroll
scrollTo X
highlight X


The console must call the public DVE API.

It must not directly manipulate internal engine state.

22. FIVE REAL TEST PAGES

Create five deliberately complex raw HTML test pages.

These are not fake engine implementations.

They are permanent engine test fixtures.

Each page should test increasingly difficult recognition scenarios.

Include:

Page 1 — Basic interface

navigation

buttons

links

inputs

forms

cards

Page 2 — Complex dashboard

sidebar

nested menus

tables

filters

dropdowns

multiple regions

responsive layout

Page 3 — Dynamic application

dynamically inserted elements

changing lists

notifications

loading states

modal dialogs

toast notifications

Page 4 — Geometry challenge

complex layouts

overlapping elements

scrollable regions

sticky headers

responsive sections

elements positioned far apart

Page 5 — Extreme interaction page

Combine:

nested components

multiple forms

dialogs

menus

dropdowns

tables

notifications

dynamic updates

scrolling

responsive behavior

difficult geometry

many interactive elements

The purpose is to prove the actual DVE engine is efficient and accurate.

23. ENGINE TESTING

The five pages must be used for automated tests.

Test:

recognition accuracy

element identity

geometry accuracy

visibility

query accuracy

spatial queries

action accuracy

scrolling

mouse movement

typing

focus

modals

toasts

dynamic changes

resizing

stale references

iframe behavior

resource usage

24. PLUGIN ARCHITECTURE

Design DVE as modular infrastructure.

Potential modules:

Browser Runtime
DOM Scanner
Accessibility Scanner
Geometry Engine
Page Map
Element Registry
Query Engine
Action Engine
Mouse Controller
Visual Overlay
Change Detection
Frame Manager
Shadow DOM Manager
Plugin System
Transport Layer


These are starting points, not mandatory final names.

Determine the best architecture during planning.

25. TRANSPORT ABSTRACTION

DVE must be usable by another application later.

Separate:

DVE Engine
      ↓
Transport Interface


Potential transports:

local process

HTTP

WebSocket

embedded runtime

The engine must not depend on a specific transport.

26. PUBLIC API

Create a clean TypeScript API.

Conceptually:

const dve = createDVE(config)

await dve.connect()

await dve.observe(query)

await dve.query(query)

await dve.act(action)


Exact APIs must be designed during architecture planning.

Use strong TypeScript types.

Use Zod for runtime validation where appropriate.

27. DOCUMENTATION

Create comprehensive Markdown documentation.

At minimum:

docs/
├── architecture.md
├── getting-started.md
├── browser-runtime.md
├── page-map.md
├── queries.md
├── actions.md
├── mouse.md
├── geometry.md
├── overlays.md
├── modals-and-toasts.md
├── frames.md
├── plugins.md
├── transports.md
├── api.md
├── security.md
├── performance.md
├── testing.md
├── framework-compatibility.md
└── integration.md


Documentation must explain exactly how another engineering team can integrate the engine.

Include working examples.

28. CLOUDFLARE / REAL-WORLD WEB COMPATIBILITY

The engine must be designed for real-world websites.

Consider environments involving:

Cloudflare

CSP

strict security headers

cross-origin iframes

SPA navigation

dynamically generated DOM

lazy loading

virtualized lists

shadow DOM

authentication pages

redirects

Do not attempt to bypass security controls.

The engine should work normally where browser automation permits it and clearly report limitations where browser security prevents access.

29. SECURITY

DVE must never:

bypass browser security

bypass CORS/Same-Origin Policy

execute arbitrary generated JavaScript

expose secrets unnecessarily

make authorization decisions

autonomously perform dangerous actions

All actions must be explicit API commands.

30. TECHNOLOGY DECISION

Before implementation, evaluate existing libraries and clearly document:

what existing libraries provide

what should be reused

what must be custom-built

why each technology was selected

Do not reinvent browser automation.

Do build the DVE abstraction itself.

31. DEVELOPMENT PROCESS

FIRST:

Inspect the repository.

SECOND:

Produce the complete technical architecture.

THIRD:

Define package/module boundaries.

FOURTH:

Define public contracts and interfaces.

FIFTH:

Define testing strategy.

SIXTH:

Define implementation phases.

STOP.

Wait for architecture approval before major implementation.

FINAL PRINCIPLE

The Control Console is not the product.

The five test pages are not the product.

The UI is not the product.

The DVE engine is the product.

Everything else exists to develop, test, inspect, and integrate the engine.

Build the engine so another application can consume it without knowing or caring how DVE internally works. ask in case of any clarification needed.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c98ece6a-13ef-4837-aa06-a7a036f5d8ca).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
