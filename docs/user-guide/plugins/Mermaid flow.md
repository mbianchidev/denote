# Paper glider flow

Enable **Mermaid diagrams** and open this note in **Rich** view. The diagram
shows a small decision loop; **Show diagram source** keeps its fence editable.

```mermaid
%% denote:title: Paper glider trial
flowchart TD
  Fold[Fold the paper] --> Test[Test the glider]
  Test --> Flight{Glides steadily?}
  Flight -->|Yes| Record[Record the result]
  Flight -->|No| Adjust[Adjust the wings]
  Adjust --> Test
```

Change a label in the source and return to the diagram. No links, scripts,
external assets, or custom styles are needed. Without the plugin, the same
fence remains readable code.
