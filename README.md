# Rainy Evening House

A small 3D browser game: run around a cozy two-storey townhouse on a rainy evening and find the 9 golden stars hidden in the living room, hall, kitchen, garden, study, landing, bathroom and bedroom.

Built with Three.js (vendored in `vendor/`, no build step). Everything — furniture, rugs, books, rain — is generated in code.

## Characters

Pick who you play as on the title card: **Ochre** (petite brunette, glasses, 1.53 m), **Plum** (tall blonde, 1.78 m) or **Scarlet** (the original sweater-and-scarf figure). The models are generated in `src/characters.js` — lofted bodies, painted faces with expressions, strand hair.

The **Character showcase** (button on the title card, the *Characters* button in game, or the `C` key) puts them on a turntable: front / side / back / face views, idle, walk, run and wave animations, facial expressions and a height line-up. Drag to orbit, scroll or pinch to zoom, Shift-drag (or two fingers) to pan up and down. `index.html#showcase` opens it directly.

## Play

Serve the folder with any static web server and open it in a browser:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly from disk won't work because browsers block ES modules on `file://`.)

## Controls

- **WASD / arrow keys** – run (hold Shift to walk)
- **Space** – jump (you can hop onto the sofa, bed, kitchen island…)
- **Mouse drag** – look around, **scroll** – zoom, **Q / E** – rotate camera
- **C** – character showcase
- **Touch** – left thumb stick to move, drag on the right side to look, Jump button

The upper floor hides while you're downstairs, dollhouse-style, and walls fade out when they block your view.
