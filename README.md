# Rainy Evening House

A small 3D browser game: run around a cozy two-storey townhouse on a rainy evening and find the 9 golden stars hidden in the living room, hall, kitchen, garden, study, landing, bathroom and bedroom.

Built with Three.js (vendored in `vendor/`, no build step). Everything — furniture, rugs, books, rain — is generated in code.

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
- **Touch** – left thumb stick to move, drag on the right side to look, Jump button

The upper floor hides while you're downstairs, dollhouse-style, and walls fade out when they block your view.
