"""
DD2419 Task Generator

This script generates a randomized map task for the DD2419 course. It samples objects,
boxes, and obstacles from a predefined set, applies a random global transformation
(translation and rotation) to the entire workspace, and exports the resulting map to CSV files.
"""

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Rectangle
from matplotlib.transforms import Affine2D
import argparse
import random
from shapely.geometry import Point, Polygon
from shapely import affinity
import pandas as pd
import os

# --- GLOBAL DATA ---
WORKSPACE_DATA = [
    (0,0), (522,0), (800,202), (1001,204), 
    (1000,422), (860,423), (859,267), (0,270)
]

START_POSES = [
    {'x': 49, 'y': 50, 'angle': 0},
    {'x': 500, 'y': 200, 'angle': 90}
]

OBJECTS = [
    {'x': 133, 'y': 222, 'angle': 0},
    {'x': 320, 'y': 146, 'angle': 0},
    {'x': 600, 'y': 100, 'angle': 0},
    {'x': 900, 'y': 300, 'angle': 0},
    {'x': 950, 'y': 350, 'angle': 0}
]

BOXES = [
    {'x': 138, 'y': 16, 'angle': 0},
    {'x': 700, 'y': 150, 'angle': 45},
    {'x': 900, 'y': 400, 'angle': -30}
]

OBSTACLES = [
    {'x': 150, 'y': 100, 'angle': 0},
    {'x': 450, 'y': 50, 'angle': 0},
    {'x': 900, 'y': 350, 'angle': 0},
    {'x': 250, 'y': 180, 'angle': 0},
    {'x': 650, 'y': 250, 'angle': 0}
]

def transform_point(x: float, y: float, tx: float, ty: float, rot_deg: float) -> tuple[float, float]:
    """Applies rotation around the origin and then translation.

    Args:
        x: Original x-coordinate.
        y: Original y-coordinate.
        tx: Translation in x.
        ty: Translation in y.
        rot_deg: Rotation angle in degrees.

    Returns:
        tuple: (new_x, new_y) after transformation.
    """
    rad = np.radians(rot_deg)
    cos_val = np.cos(rad)
    sin_val = np.sin(rad)
    
    rx = x * cos_val - y * sin_val
    ry = x * sin_val + y * cos_val
    
    return rx + tx, ry + ty

def sample_unique(source: list, count: int, name: str) -> list:
    """Samples a specified number of unique items from a source list.

    If the requested count exceeds the available items, items will be reused.

    Args:
        source: The list to sample from.
        count: Number of items to sample.
        name: Name of the item type (for warning messages).

    Returns:
        Sampled items.
    """
    if count > len(source):
        print(f"Warning: Requested {count} {name}, but only {len(source)} available. Some will be reused.")
        return random.choices(source, k=count)
    return random.sample(source, k=count)

def main() -> None:
    """Main execution function for the task generator."""
    parser = argparse.ArgumentParser(description='DD2419 Task Generator: Randomly sample and transform a map.',
                                     formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('folder', help='Directory where map files will be saved')
    parser.add_argument('--num_known_objects', type=int, default=1, help='Number of known objects')
    parser.add_argument('--num_unknown_objects', type=int, default=4, help='Number of unknown objects')
    parser.add_argument('--num_known_boxes', type=int, default=1, help='Number of known boxes')
    parser.add_argument('--num_unknown_boxes', type=int, default=1, help='Number of unknown boxes')
    parser.add_argument('--num_obstacles', type=int, default=3, help='Number of obstacles')
    parser.add_argument('--transform_workspace', type=str, default='True', help='Transform workspace (True/False)')
    
    args = parser.parse_args()
    args.transform_workspace = args.transform_workspace.lower() == 'true'
    
    os.makedirs(args.folder, exist_ok=True)
    
    shift = random.randint(0, len(WORKSPACE_DATA) - 1)
    shifted_workspace = WORKSPACE_DATA[shift:] + WORKSPACE_DATA[:shift]
    print(f"Generating task in `{args.folder}` with parameters: {args}")

    start_pose = random.choice(START_POSES)

    total_objs_needed = args.num_known_objects + args.num_unknown_objects
    sampled_objs = sample_unique(OBJECTS, total_objs_needed, "objects")
    known_objects = sampled_objs[:args.num_known_objects]
    unknown_objects = sampled_objs[args.num_known_objects:]

    total_boxes_needed = args.num_known_boxes + args.num_unknown_boxes
    sampled_boxes = sample_unique(BOXES, total_boxes_needed, "boxes")
    known_boxes = sampled_boxes[:args.num_known_boxes]
    unknown_boxes = sampled_boxes[args.num_known_boxes:]

    obstacles = sample_unique(OBSTACLES, args.num_obstacles, "obstacles")

    original_ws_poly = Polygon(shifted_workspace)
    if args.transform_workspace:
        tx = random.uniform(-1000, 1000)
        ty = random.uniform(-1000, 1000)
        rot_deg = random.uniform(0, 360)
        print(f"Applying Global Transform: TX={tx:.1f}, TY={ty:.1f}, ROT={rot_deg:.1f}")

        ws_poly = affinity.rotate(original_ws_poly, rot_deg, origin=(0, 0))
        ws_poly = affinity.translate(ws_poly, xoff=tx, yoff=ty)
        
        def apply_transform(item):
            nx, ny = transform_point(item['x'], item['y'], tx, ty, rot_deg)
            new_item = item.copy()
            new_item['x'], new_item['y'] = nx, ny
            if 'angle' in item:
                new_item['angle'] = (item['angle'] + rot_deg) % 360
            return new_item

        start_pose = apply_transform(start_pose)
        known_objects = [apply_transform(o) for o in known_objects]
        unknown_objects = [apply_transform(o) for o in unknown_objects]
        known_boxes = [apply_transform(b) for b in known_boxes]
        unknown_boxes = [apply_transform(b) for b in unknown_boxes]
        obstacles = [apply_transform(o) for o in obstacles]
    else:
        ws_poly = original_ws_poly

    # -- Export to CSV --
    ws_coords = list(zip(*ws_poly.exterior.xy))[:-1]
    pd.DataFrame(ws_coords, columns=['x', 'y']).to_csv(os.path.join(args.folder, 'workspace.csv'), index=False)
    
    map_data = []
    map_data.append({'Type': 'S', 'x': start_pose['x'], 'y': start_pose['y'], 'angle': start_pose['angle']})
    for o in known_objects:
        map_data.append({'Type': 'O', 'x': o['x'], 'y': o['y'], 'angle': 0})
    for b in known_boxes:
        map_data.append({'Type': 'B', 'x': b['x'], 'y': b['y'], 'angle': b['angle']})
    pd.DataFrame(map_data).to_csv(os.path.join(args.folder, 'map.csv'), index=False)
    
    map_complete_data = list(map_data)
    for o in unknown_objects:
        map_complete_data.append({'Type': 'O', 'x': o['x'], 'y': o['y'], 'angle': 0})
    for b in unknown_boxes:
        map_complete_data.append({'Type': 'B', 'x': b['x'], 'y': b['y'], 'angle': b['angle']})
    pd.DataFrame(map_complete_data).to_csv(os.path.join(args.folder, 'map_complete.csv'), index=False)

    print(f"CSV files saved to `{args.folder}`: workspace.csv, map.csv, map_complete.csv")

    # -- Visualization --
    plt.figure(figsize=(12, 10))
    ax = plt.gca()
    
    x_ws, y_ws = ws_poly.exterior.xy
    plt.plot(x_ws, y_ws, marker='.', linestyle='-', color='deepskyblue', alpha=0.8, label='Workspace perimeter')

    legend_elements = []
    legend_elements.append(plt.Line2D([0], [0], color='deepskyblue', alpha=0.8, linestyle='-', marker='.', label='Workspace perimeter'))

    sp_color = 'green'
    angle_rad = np.radians(start_pose['angle'])
    u, v = np.cos(angle_rad), np.sin(angle_rad)
    plt.arrow(start_pose['x'], start_pose['y'], u * 20, v * 20, 
              color=sp_color, width=0.5, head_width=8, head_length=8,
              length_includes_head=True, zorder=6)
    legend_elements.append(plt.Line2D([0], [0], color=sp_color, marker='$\u279E$', linestyle='None', markersize=10, label='Start Pose'))

    obj_size = 10
    for row in known_objects:
        rect = Rectangle((row['x'] - obj_size/2, row['y'] - obj_size/2), 
                         obj_size, obj_size, color='darkred', alpha=0.8)
        ax.add_patch(rect)
    legend_elements.append(plt.Line2D([0], [0], color='darkred', marker='s', linestyle='None', alpha=0.8, label='Known Object'))

    for row in unknown_objects:
        rect = Rectangle((row['x'] - obj_size/2, row['y'] - obj_size/2), 
                         obj_size, obj_size, facecolor='none', edgecolor='darkred', linewidth=2, alpha=0.8)
        ax.add_patch(rect)
    legend_elements.append(plt.Line2D([0], [0], color='darkred', marker='s', linestyle='None', markerfacecolor='none', markersize=10, markeredgewidth=2, label='Unknown Object'))

    box_width, box_height = 24, 16
    for row in known_boxes:
        rect = Rectangle((-box_width/2, -box_height/2), box_width, box_height, color='navy', alpha=0.6)
        t = Affine2D().rotate_deg(row['angle']).translate(row['x'], row['y']) + ax.transData
        rect.set_transform(t)
        ax.add_patch(rect)
    legend_elements.append(Rectangle((0, 0), 1.5, 1, color='navy', alpha=0.6, label='Known Box'))

    for row in unknown_boxes:
        rect = Rectangle((-box_width/2, -box_height/2), box_width, box_height, facecolor='none', edgecolor='navy', linewidth=2, alpha=0.6)
        t = Affine2D().rotate_deg(row['angle']).translate(row['x'], row['y']) + ax.transData
        rect.set_transform(t)
        ax.add_patch(rect)
    legend_elements.append(Rectangle((0, 0), 1.5, 1, facecolor='none', edgecolor='navy', linewidth=2, alpha=0.6, label='Unknown Box'))

    if obstacles:
        x_obs = [row['x'] for row in obstacles]
        y_obs = [row['y'] for row in obstacles]
        plt.scatter(x_obs, y_obs, color='black', marker='x', s=100, zorder=8)
        legend_elements.append(plt.Line2D([0], [0], color='black', marker='x', linestyle='None', markersize=10, label='Obstacle'))

    plt.xlabel('X coordinate (cm)')
    plt.ylabel('Y coordinate (cm)')
    plt.axis('equal')
    plt.title('DD2419 Task Generator: Sampled Map')
    
    plt.legend(handles=legend_elements, handlelength=1.5, handleheight=1.0)
    plt.grid(True, linestyle='--', alpha=0.6)
    
    output_file = os.path.join(args.folder, "visualization.png")
    plt.savefig(output_file)
    print(f"Visualization saved to {output_file}")

if __name__ == "__main__":
    main()
