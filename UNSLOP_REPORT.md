# CharMsg interface redline

Direction approved by the user: a nocturnal, intimate, playful community for
conversations and collections. Graphite chrome; muted lilac selection; rich gift
artwork and personal profiles. Existing features, navigation order and logo kept.

Implemented in css/interface.css, loaded after the original design and gift effects:
- Spacing: 4px rhythm, consistent controls, cards, section groups and mobile edges.
- Color: graphite surfaces, three readable text roles, quiet borders, no background orbs.
- Icons: existing icons preserved; no new decorative icons or dependencies added.
- Copy: existing product labels retained; no invented features or claims.
- Type: calmer headings, tabular figures, larger captions, sentence-case labels.
- Layout: existing fluid application shell and four main sections retained.
- Details: consistent control and panel radii, keyboard focus, readable tables.
- Visuals: actual gifts carry colour; no generated images needed.
- Motion: removed hover lift and decorative glow from primary controls.

Checks: build, navigation regression and refresh tests passed. Browser session had
closed before the final fixture run; final visual comparison and real-device
checks remain outstanding. Existing theme-specific rules and inline component
styles need further review before claiming a complete site-wide redesign.
Browser follow-up: Chromium fixture using the actual shell and styles passed at
1440, 768, 390 and 360px: no horizontal overflow, working input/select/button,
44px primary touch control on mobile, no page JavaScript errors, reduced-motion
setting disables flame animation. Desktop and mobile screenshots visually inspected.
This verifies shared styles and representative components, not authenticated flows
or a physical iOS/Android device. Not published.

Method credit: unslop by Damir Sokolovsky (@heydamir),
https://heydamir.design/unslop — CC BY 4.0. Adapted for CharMsg.
