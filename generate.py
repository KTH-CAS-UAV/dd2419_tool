"""
This script generates a randomized map task for the DD2419 course. It handles:
- Sampling objects, boxes, and obstacles from a predefined dataset.
- Applying random global transformations (translation and rotation).
- Interactive parameter prompting with validation.
- Selective map updates with robust transform reversal and re-application.
- Exporting map data to CSV and generating visualizations.
"""

import matplotlib.pyplot as plt
import numpy as np
import argparse
import random
import os
import sys
from matplotlib.patches import Rectangle
from matplotlib.transforms import Affine2D
from shapely.geometry import Point, Polygon
from shapely import affinity
import pandas as pd

# --- GLOBAL DATA ---
WORKSPACE_DATA = [
    (0,0), (522,0), (800,202), (1001,204), 
    (1000,422), (860,423), (859,267), (0,270)
]

START_POSES = [
    {'x': 49, 'y': 50, 'angle': 0},
    {'x': 49, 'y': 50, 'angle': 90},
    {'x': 240, 'y': 200, 'angle': -90},
    {'x': 240, 'y': 200, 'angle': 0},
    {'x': 522, 'y': 221, 'angle': -90},
    {'x': 522, 'y': 221, 'angle': 0},
    {'x': 925, 'y': 378, 'angle': -90}
]

OBJECTS = [
    {'x': 877, 'y': 383, 'angle': 0},
    {'x': 969, 'y': 312, 'angle': 0},
    {'x': 966, 'y': 234, 'angle': 0},
    {'x': 226, 'y': 15, 'angle': 0},
    {'x': 266, 'y': 19, 'angle': 0},
    {'x': 23, 'y': 249, 'angle': 0},
    {'x': 133, 'y': 222, 'angle': 0},
    {'x': 320, 'y': 146, 'angle': 0},
    {'x': 320, 'y': 233, 'angle': 0},
    {'x': 422, 'y': 122, 'angle': 0},
    {'x': 518, 'y': 24, 'angle': 0},
    {'x': 522, 'y': 124, 'angle': 0},
    {'x': 684, 'y': 130, 'angle': 0},
    {'x': 637, 'y': 251, 'angle': 0}
]

BOXES = [
    {'x': 876, 'y': 343, 'angle': 90},
    {'x': 140, 'y': 16, 'angle': 0},
    {'x': 420, 'y': 155, 'angle': 90},
    {'x': 639, 'y': 100, 'angle': 40}
]

def is_same(p1: dict, p2: dict) -> bool:
    """Check if two items are at the same (x, y) position within a small tolerance.
    
    Args:
        p1: First item dictionary (must contain 'x' and 'y').
        p2: Second item dictionary (must contain 'x' and 'y').
        
    Returns:
        True if the positions match, False otherwise.
    """
    return np.isclose(p1['x'], p2['x']) and np.isclose(p1['y'], p2['y'])

OBSTACLES = [
    {'x': 150, 'y': 100, 'angle': 0},
    {'x': 450, 'y': 50, 'angle': 0},
    {'x': 900, 'y': 350, 'angle': 0},
    {'x': 250, 'y': 180, 'angle': 0},
    {'x': 650, 'y': 250, 'angle': 0}
]

def transform_point(x: float, y: float, tx: float, ty: float, rot_deg: float) -> tuple[float, float]:
    """Apply global rotation and translation to a point."""
    angle_rad = np.radians(rot_deg)
    nx = x * np.cos(angle_rad) - y * np.sin(angle_rad) + tx
    ny = x * np.sin(angle_rad) + y * np.cos(angle_rad) + ty
    return nx, ny

def inverse_transform_point(nx: float, ny: float, tx: float, ty: float, rot_deg: float) -> tuple[float, float]:
    """Reverse a global transformation (nx, ny) -> (x, y)."""
    x_untranslated = nx - tx
    y_untranslated = ny - ty
    
    angle_rad = np.radians(-rot_deg)
    x = x_untranslated * np.cos(angle_rad) - y_untranslated * np.sin(angle_rad)
    y = x_untranslated * np.sin(angle_rad) + y_untranslated * np.cos(angle_rad)
    return x, y

def find_transform(base_pts: list[tuple[float, float]], trans_pts: list[tuple[float, float]]) -> tuple[float, float, float, int]:
    """Determines the (tx, ty, rot, shift) that transforms base_pts to trans_pts.
    
    Uses centroid alignment and median rotation difference for robustness.
    """
    base = np.array(base_pts)
    trans = np.array(trans_pts)
    n = len(base)
    best_err = float('inf')
    best_params = (0.0, 0.0, 0.0, 0)
    
    for shift in range(n):
        shifted_base = np.roll(base, -shift, axis=0)
        c_base, c_trans = np.mean(shifted_base, axis=0), np.mean(trans, axis=0)
        q_base, q_trans = shifted_base - c_base, trans - c_trans
        
        # Median angle difference for robustness against noise
        rot_rad = np.median(np.arctan2(q_trans[:, 1], q_trans[:, 0]) - np.arctan2(q_base[:, 1], q_base[:, 0]))
        rot_deg = np.degrees(rot_rad)
        
        # Translation: T = centroid_trans - Rotate(centroid_base, rot)
        tx = c_trans[0] - (c_base[0] * np.cos(rot_rad) - c_base[1] * np.sin(rot_rad))
        ty = c_trans[1] - (c_base[0] * np.sin(rot_rad) + c_base[1] * np.cos(rot_rad))
        
        pred_x = shifted_base[:, 0] * np.cos(rot_rad) - shifted_base[:, 1] * np.sin(rot_rad) + tx
        pred_y = shifted_base[:, 0] * np.sin(rot_rad) + shifted_base[:, 1] * np.cos(rot_rad) + ty
        err = np.mean(np.sqrt((pred_x - trans[:,0])**2 + (pred_y - trans[:,1])**2))
        
        if err < best_err:
            best_err, best_params = err, (tx, ty, rot_deg, shift)
            
    return best_params

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

def get_validated_int_input(prompt_text: str, label: str, min_val: int, max_val: int) -> int:
    """Helper to get and validate integer input. Terminate on error."""
    full_prompt = f"{prompt_text} [{min_val}, {max_val}]: "
    try:
        val_str = input(full_prompt).strip()
        if not val_str:
            print(f"Error: {label} cannot be empty.")
            sys.exit(1)
        val = int(val_str)
        if val < min_val or val > max_val:
            print(f"Error: {label} must be between {min_val} and {max_val}. Got {val}.")
            sys.exit(1)
        return val
    except ValueError:
        print(f"Error: {label} must be an integer.")
        sys.exit(1)

def export_map_to_csv(folder: str, 
                      ws_poly: Polygon, 
                      start_pose: dict, 
                      known_objects: list[dict], 
                      unknown_objects: list[dict], 
                      known_boxes: list[dict], 
                      unknown_boxes: list[dict], 
                      obstacles: list[dict]) -> None:
    """Consolidated logic to export map state to three CSV files and save a visualization plot.
    
    Files generated:
    - workspace.csv: The boundary polygon coordinates.
    - map.csv: Known items only (S, O, B).
    - map_complete.csv: All items (Known, Unknown, and Obstacles).
    - visualization.png: A top-down plot focusing on known items.
    - visualization_complete.png: A top-down plot of the full environment.
    """
    # -- Export to CSV --
    ws_coords = list(zip(*ws_poly.exterior.xy))[:-1]
    pd.DataFrame(ws_coords, columns=['x', 'y']).to_csv(os.path.join(folder, 'workspace.csv'), index=False)
    
    map_data = []
    map_data.append({'Type': 'S', 'x': start_pose['x'], 'y': start_pose['y'], 'angle': start_pose['angle']})
    for o in known_objects:
        map_data.append({'Type': 'O', 'x': o['x'], 'y': o['y'], 'angle': 0})
    for b in known_boxes:
        map_data.append({'Type': 'B', 'x': b['x'], 'y': b['y'], 'angle': b['angle']})
    pd.DataFrame(map_data).to_csv(os.path.join(folder, 'map.csv'), index=False)
    
    map_complete_data = list(map_data)
    for o in unknown_objects:
        map_complete_data.append({'Type': 'O', 'x': o['x'], 'y': o['y'], 'angle': 0})
    for b in unknown_boxes:
        map_complete_data.append({'Type': 'B', 'x': b['x'], 'y': b['y'], 'angle': b['angle']})
    for obs in obstacles:
        map_complete_data.append({'Type': 'P', 'x': obs['x'], 'y': obs['y'], 'angle': 0})
    pd.DataFrame(map_complete_data).to_csv(os.path.join(folder, 'map_complete.csv'), index=False)

    print(f"CSV files saved to `{folder}`: workspace.csv, map.csv, map_complete.csv")

def save_plot(folder: str, 
              filename: str, 
              ws_poly: Polygon, 
              start_pose: dict, 
              known_objects: list[dict], 
              unknown_objects: list[dict], 
              known_boxes: list[dict], 
              unknown_boxes: list[dict], 
              obstacles: list[dict],
              unused_objects: list[dict] = None,
              unused_boxes: list[dict] = None,
              title_suffix: str = "",
              show_pose: bool = True,
              show_obstacles: bool = True,
              is_placement: bool = False) -> None:
    """Generates and saves a top-down visualization plot of the map.
    
    This function handles both the standard map visualizations (known/complete) 
    and the simplified placement visualization.
    
    Args:
        folder: Output directory.
        filename: Name of the file to save.
        ws_poly: Workspace boundary polygon.
        start_pose: Starting pose dictionary (x, y, angle).
        known_objects: List of known objects.
        unknown_objects: List of unknown objects.
        known_boxes: List of known boxes.
        unknown_boxes: List of unknown boxes.
        obstacles: List of obstacles.
        unused_objects: List of objects not sampled from the dataset.
        unused_boxes: List of boxes not sampled from the dataset.
        title_suffix: Suffix for the plot title.
        show_pose: Whether to render the start pose arrow.
        show_obstacles: Whether to render obstacle markers.
        is_placement: If True, uses simplified 'Used' vs 'Unused' styling.
    """
    plt.figure(figsize=(12, 10))
    ax = plt.gca()
    
    x_ws, y_ws = ws_poly.exterior.xy
    plt.plot(x_ws, y_ws, marker='.', linestyle='-', color='deepskyblue', alpha=0.8)
    
    legend_elements = [
        plt.Line2D([0], [0], color='deepskyblue', alpha=0.8, linestyle='-', marker='.', label='Workspace perimeter')
    ]

    # Start Pose
    if show_pose:
        angle_rad = np.radians(start_pose['angle'])
        u, v = np.cos(angle_rad), np.sin(angle_rad)
        plt.arrow(start_pose['x'], start_pose['y'], u * 20, v * 20, 
                  color='green', width=0.5, head_width=8, head_length=8,
                  length_includes_head=True, zorder=6)
        legend_elements.append(plt.Line2D([0], [0], color='green', marker='$\u279E$', linestyle='None', markersize=10, label='Start Pose'))

    # Objects
    obj_size = 10
    for row in known_objects:
        ax.add_patch(Rectangle((row['x'] - obj_size/2, row['y'] - obj_size/2), 
                                 obj_size, obj_size, color='darkred', alpha=0.8))
    
    if is_placement:
        legend_elements.append(plt.Line2D([0], [0], color='darkred', marker='s', linestyle='None', alpha=0.8, label='Used Object'))
    else:
        legend_elements.append(plt.Line2D([0], [0], color='darkred', marker='s', linestyle='None', alpha=0.8, label='Known Object'))

    if unknown_objects:
        for row in unknown_objects:
            ax.add_patch(Rectangle((row['x'] - obj_size/2, row['y'] - obj_size/2), 
                                     obj_size, obj_size, facecolor='none' if not is_placement else 'darkred', 
                                     edgecolor='darkred', linewidth=2, alpha=0.8))
        if not is_placement:
            legend_elements.append(plt.Line2D([0], [0], color='darkred', marker='s', linestyle='None', markerfacecolor='none', markersize=10, markeredgewidth=2, label='Unknown Object'))

    if unused_objects:
        for row in unused_objects:
            ax.add_patch(Rectangle((row['x'] - obj_size/2, row['y'] - obj_size/2), 
                                     obj_size, obj_size, color='gray', alpha=0.3))
        legend_elements.append(plt.Line2D([0], [0], color='gray', marker='s', linestyle='None', alpha=0.3, label='Unused Object'))

    # Boxes
    box_width, box_height = 24, 16
    for row in known_boxes:
        rect = Rectangle((-box_width/2, -box_height/2), box_width, box_height, color='navy', alpha=0.6)
        t = Affine2D().rotate_deg(row['angle']).translate(row['x'], row['y']) + ax.transData
        rect.set_transform(t)
        ax.add_patch(rect)
    
    if is_placement:
        legend_elements.append(Rectangle((0, 0), 1.5, 1, color='navy', alpha=0.6, label='Used Box'))
    else:
        legend_elements.append(Rectangle((0, 0), 1.5, 1, color='navy', alpha=0.6, label='Known Box'))

    if unknown_boxes:
        for row in unknown_boxes:
            rect = Rectangle((-box_width/2, -box_height/2), box_width, box_height, 
                             facecolor='none' if not is_placement else 'navy', 
                             edgecolor='navy', linewidth=2, alpha=0.6)
            t = Affine2D().rotate_deg(row['angle']).translate(row['x'], row['y']) + ax.transData
            rect.set_transform(t)
            ax.add_patch(rect)
        if not is_placement:
            legend_elements.append(Rectangle((0, 0), 1.5, 1, facecolor='none', edgecolor='navy', linewidth=2, alpha=0.6, label='Unknown Box'))

    if unused_boxes:
        for row in unused_boxes:
            rect = Rectangle((-box_width/2, -box_height/2), box_width, box_height, color='slategray', alpha=0.2)
            t = Affine2D().rotate_deg(row['angle']).translate(row['x'], row['y']) + ax.transData
            rect.set_transform(t)
            ax.add_patch(rect)
        legend_elements.append(Rectangle((0, 0), 1.5, 1, color='slategray', alpha=0.2, label='Unused Box'))

    # Obstacles
    if show_obstacles and obstacles:
        x_obs = [row['x'] for row in obstacles]
        y_obs = [row['y'] for row in obstacles]
        plt.scatter(x_obs, y_obs, color='black', marker='x', s=100, zorder=8)
        legend_elements.append(plt.Line2D([0], [0], color='black', marker='x', linestyle='None', markersize=10, label='Obstacle'))

    plt.xlabel('X coordinate (cm)')
    plt.ylabel('Y coordinate (cm)')
    plt.axis('equal')
    plt.title(f'DD2419 Task Generator: {title_suffix}')
    plt.legend(handles=legend_elements, handlelength=1.5, handleheight=1.0)
    plt.grid(True, linestyle='--', alpha=0.6)
    
    plt.savefig(os.path.join(folder, filename))
    plt.close()

def export_map_to_csv(folder: str, 
                      ws_poly: Polygon, 
                      start_pose: dict, 
                      known_objects: list[dict], 
                      unknown_objects: list[dict], 
                      known_boxes: list[dict], 
                      unknown_boxes: list[dict], 
                      obstacles: list[dict],
                      # Base items for placement visualization
                      ws_poly_base: Polygon = None,
                      start_pose_base: dict = None,
                      known_objects_base: list[dict] = None,
                      unknown_objects_base: list[dict] = None,
                      known_boxes_base: list[dict] = None,
                      unknown_boxes_base: list[dict] = None,
                      unused_objects_base: list[dict] = None,
                      unused_boxes_base: list[dict] = None,
                      obstacles_base: list[dict] = None) -> None:
    """Export map state to three CSV files and save visualization plots.
    
    Generates:
    - workspace.csv: The boundary polygon coordinates.
    - map.csv: Known items only (S, O, B).
    - map_complete.csv: All items (Known, Unknown, and Obstacles).
    - visualization.png: Known items (transformed).
    - visualization_complete.png: All items (transformed).
    - visualization_placement.png: All items + unused items (base coordinates, simplified).
    
    Args:
        folder: Destination directory.
        [... other arguments reflect current and base coordinate states ...]
    """
    # -- Export to CSV --
    ws_coords = list(zip(*ws_poly.exterior.xy))[:-1]
    pd.DataFrame(ws_coords, columns=['x', 'y']).to_csv(os.path.join(folder, 'workspace.csv'), index=False)
    
    map_data = []
    map_data.append({'Type': 'S', 'x': start_pose['x'], 'y': start_pose['y'], 'angle': start_pose['angle']})
    for o in known_objects:
        map_data.append({'Type': 'O', 'x': o['x'], 'y': o['y'], 'angle': 0})
    for b in known_boxes:
        map_data.append({'Type': 'B', 'x': b['x'], 'y': b['y'], 'angle': b['angle']})
    pd.DataFrame(map_data).to_csv(os.path.join(folder, 'map.csv'), index=False)
    
    map_complete_data = list(map_data)
    for o in unknown_objects:
        map_complete_data.append({'Type': 'O', 'x': o['x'], 'y': o['y'], 'angle': 0})
    for b in unknown_boxes:
        map_complete_data.append({'Type': 'B', 'x': b['x'], 'y': b['y'], 'angle': b['angle']})
    for obs in obstacles:
        map_complete_data.append({'Type': 'P', 'x': obs['x'], 'y': obs['y'], 'angle': 0})
    pd.DataFrame(map_complete_data).to_csv(os.path.join(folder, 'map_complete.csv'), index=False)

    print(f"CSV files saved to `{folder}`: workspace.csv, map.csv, map_complete.csv")

    # -- Visualizations --
    # 1. Known Map
    save_plot(folder, "visualization.png", ws_poly, start_pose, 
              known_objects, [], known_boxes, [], [], 
              title_suffix="Known Map")
    
    # 2. Complete Map
    save_plot(folder, "visualization_complete.png", ws_poly, start_pose, 
              known_objects, unknown_objects, known_boxes, unknown_boxes, obstacles, 
              title_suffix="Complete Map")

    # 3. Placement Map (Base Coordinates)
    if ws_poly_base and start_pose_base:
        save_plot(folder, "visualization_placement.png", ws_poly_base, start_pose_base,
                  known_objects_base, unknown_objects_base, known_boxes_base, unknown_boxes_base, obstacles_base,
                  unused_objects=unused_objects_base, unused_boxes=unused_boxes_base,
                  title_suffix="All Possible Placements",
                  show_pose=False, show_obstacles=False, is_placement=True)
        print(f"Visualizations saved to `{folder}`: visualization.png, visualization_complete.png, visualization_placement.png")
    else:
        print(f"Visualizations saved to `{folder}`: visualization.png, visualization_complete.png")

def generate_fresh_map(folder: str) -> None:
    """Handles the creation of a completely new map or an overwrite.
    
    Prompts the user for all map parameters (counts, transform), performs the sampling,
    applies a global transformation, and exports the results.
    """
    num_known_objects = get_validated_int_input("Number of known objects", "known objects", 0, len(OBJECTS) - 2)
    num_unknown_objects = get_validated_int_input("Number of unknown objects", "unknown objects", 2, len(OBJECTS) - num_known_objects)
    num_known_boxes = get_validated_int_input("Number of known boxes", "known boxes", 1, len(BOXES) - 1)
    num_unknown_boxes = get_validated_int_input("Number of unknown boxes", "unknown boxes", 1, len(BOXES) - num_known_boxes)
    num_obstacles_count = get_validated_int_input("Number of obstacles", "obstacles", 0, 5)
    
    tw_input = input("Transform workspace (True/False): ").lower().strip()
    if tw_input not in ['true', 'false']:
        print("Error: Transform workspace must be 'true' or 'false'.")
        sys.exit(1)
    transform_workspace = tw_input == 'true'

    shift = random.randint(0, len(WORKSPACE_DATA) - 1)
    shifted_workspace = WORKSPACE_DATA[shift:] + WORKSPACE_DATA[:shift]
    print(f"Generating task in `{folder}`")

    start_pose_base = random.choice(START_POSES)
    start_pose = start_pose_base.copy()

    total_objs_needed = num_known_objects + num_unknown_objects
    sampled_objs = sample_unique(OBJECTS, total_objs_needed, "objects")
    known_objects_base = sampled_objs[:num_known_objects]
    unknown_objects_base = sampled_objs[num_known_objects:]
    known_objects = [o.copy() for o in known_objects_base]
    unknown_objects = [o.copy() for o in unknown_objects_base]

    total_boxes_needed = num_known_boxes + num_unknown_boxes
    sampled_boxes = sample_unique(BOXES, total_boxes_needed, "boxes")
    known_boxes_base = sampled_boxes[:num_known_boxes]
    unknown_boxes_base = sampled_boxes[num_known_boxes:]
    known_boxes = [b.copy() for b in known_boxes_base]
    unknown_boxes = [b.copy() for b in unknown_boxes_base]

    obstacles = sample_unique(OBSTACLES, num_obstacles_count, "obstacles")

    unused_objects_base = [o for o in OBJECTS if not any(is_same(o, so) for so in sampled_objs)]
    unused_boxes_base = [b for b in BOXES if not any(is_same(b, sb) for sb in sampled_boxes)]

    original_ws_poly = Polygon(shifted_workspace)
    if transform_workspace:
        tx, ty = random.uniform(-1000, 1000), random.uniform(-1000, 1000)
        rot_deg = random.uniform(0, 360)
        print(f"Applying Global Transform: TX={tx:.1f}, TY={ty:.1f}, ROT={rot_deg:.1f}")

        ws_poly = affinity.rotate(original_ws_poly, rot_deg, origin=(0, 0))
        ws_poly = affinity.translate(ws_poly, xoff=tx, yoff=ty)
        
        def apply_transform(item: dict) -> dict:
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

    export_map_to_csv(folder, ws_poly, start_pose, known_objects, unknown_objects, known_boxes, unknown_boxes, obstacles,
                      ws_poly_base=original_ws_poly, start_pose_base=start_pose_base,
                      known_objects_base=known_objects_base, unknown_objects_base=unknown_objects_base,
                      known_boxes_base=known_boxes_base, unknown_boxes_base=unknown_boxes_base,
                      unused_objects_base=unused_objects_base, unused_boxes_base=unused_boxes_base,
                      obstacles_base=obstacles)

def update_existing_map(folder: str) -> None:
    """Selective update of an existing map in base coordinates.
    
    This function:
    1. Loads the current map and workspace.
    2. Automatically detects the global transformation applied to the workspace.
    3. Normalizes all existing items back to the base coordinate system.
    4. Applies user-selected updates (pose, sampling, or transform) in base coordinates.
    5. Re-applies a consistent global transformation to all items before export.
    """
    existing_ws = pd.read_csv(os.path.join(folder, 'workspace.csv'))
    existing_map = pd.read_csv(os.path.join(folder, 'map.csv'))
    existing_map_complete = pd.read_csv(os.path.join(folder, 'map_complete.csv'))
    
    print("What should be updated? (comma-separated list of numbers)")
    print("1. Sample new known objects")
    print("2. Sample new known boxes")
    print("3. Apply transform")
    print("4. Change starting pose")
    update_choices = [c.strip() for c in input("Choices: ").split(',')]
    
    update_objects = '1' in update_choices
    update_boxes = '2' in update_choices
    update_transform = '3' in update_choices
    update_start_pose = '4' in update_choices
    
    # Identify Old Transform
    trans_pts = list(zip(existing_ws['x'], existing_ws['y']))
    tx_old, ty_old, rot_old, shift_old = find_transform(WORKSPACE_DATA, trans_pts)
    
    def reverse_item(item: dict) -> dict:
        nx, ny = inverse_transform_point(item['x'], item['y'], tx_old, ty_old, rot_old)
        new_item = item.copy()
        new_item['x'], new_item['y'] = nx, ny
        if 'angle' in item:
            new_item['angle'] = (item['angle'] - rot_old) % 360
        return new_item

    def snap_to_global(item: dict, global_list: list[dict]) -> dict:
        """Find the closest matching item in a global dataset to ensure coordinate consistency.
        
        This prevents floating-point drift when reverse-transforming objects for placement maps.
        
        Args:
            item: The item to snap.
            global_list: The list of canonical items to match against.
            
        Returns:
            The canonical item from global_list if a match is found, otherwise the input item.
        """
        for g_item in global_list:
            if is_same(item, g_item):
                return g_item.copy()
        return item

    # Load and reverse all items to base coordinates with snapping
    all_objects_df = existing_map_complete[existing_map_complete['Type'] == 'O']
    all_objects_base = [snap_to_global(reverse_item({'x': r['x'], 'y': r['y'], 'angle': r['angle']}), OBJECTS) for _, r in all_objects_df.iterrows()]
    
    all_boxes_df = existing_map_complete[existing_map_complete['Type'] == 'B']
    all_boxes_base = [snap_to_global(reverse_item({'x': r['x'], 'y': r['y'], 'angle': r['angle']}), BOXES) for _, r in all_boxes_df.iterrows()]
    
    if 'P' in existing_map_complete['Type'].values:
        obs_df = existing_map_complete[existing_map_complete['Type'] == 'P']
        obstacles_base = [snap_to_global(reverse_item({'x': r['x'], 'y': r['y']}), OBSTACLES) for _, r in obs_df.iterrows()]
    else:
        obstacles_base = []

    start_row = existing_map[existing_map['Type'] == 'S'].iloc[0]
    start_pose_base = snap_to_global(reverse_item({'x': start_row['x'], 'y': start_row['y'], 'angle': start_row['angle']}), START_POSES)
    
    known_objects_df = existing_map[existing_map['Type'] == 'O']
    known_objects_base = [snap_to_global(reverse_item({'x': r['x'], 'y': r['y'], 'angle': r['angle']}), OBJECTS) for _, r in known_objects_df.iterrows()]
    
    known_boxes_df = existing_map[existing_map['Type'] == 'B']
    known_boxes_base = [snap_to_global(reverse_item({'x': r['x'], 'y': r['y'], 'angle': r['angle']}), BOXES) for _, r in known_boxes_df.iterrows()]

    # Apply Updates in Base Coordinates
    if update_start_pose:
        start_pose_base = random.choice(START_POSES)
        print("Updated starting pose in base coordinate system.")

    if update_objects:
        if len(all_objects_base) > 2:
            cnt = get_validated_int_input("Number of known objects", "known objects", 0, len(all_objects_base) - 2)
        else:
            print(f"Note: Not possible to sample new objects as only {len(all_objects_base)} objects exist (2 must be unknown). Setting known objects to 0.")
            cnt = 0
        known_objects_base = random.sample(all_objects_base, cnt)
        print(f"Updated known objects (sampled {cnt} from {len(all_objects_base)}).")

    if update_boxes:
        if len(all_boxes_base) > 2:
            cnt = get_validated_int_input("Number of known boxes", "known boxes", 1, len(all_boxes_base) - 1)
        else:
            print(f"Note: Not possible to sample new boxes as only {len(all_boxes_base)} boxes exist (1 known + 1 unknown required). Setting known boxes to 1.")
            cnt = 1
        known_boxes_base = random.sample(all_boxes_base, cnt)
        print(f"Updated known boxes (sampled {cnt} from {len(all_boxes_base)}).")

    unknown_objects_base = [o for o in all_objects_base if not any(is_same(o, ko) for ko in known_objects_base)]
    unknown_boxes_base = [b for b in all_boxes_base if not any(is_same(b, kb) for kb in known_boxes_base)]

    # Select final transform
    if update_transform:
        tx, ty = random.uniform(-1000, 1000), random.uniform(-1000, 1000)
        rot_deg = random.uniform(0, 360)
        print(f"Applying NEW Global Transform: TX={tx:.1f}, TY={ty:.1f}, ROT={rot_deg:.1f}")
    else:
        tx, ty, rot_deg = tx_old, ty_old, rot_old
        print(f"Preserving EXISTING Global Transform: TX={tx:.1f}, TY={ty:.1f}, ROT={rot_deg:.1f}")

    # Re-apply transform to everything consistently
    shifted_ws = WORKSPACE_DATA[shift_old:] + WORKSPACE_DATA[:shift_old]
    ws_poly = Polygon(shifted_ws)
    ws_poly = affinity.rotate(ws_poly, rot_deg, origin=(0, 0))
    ws_poly = affinity.translate(ws_poly, xoff=tx, yoff=ty)

    def apply_final_trans(item: dict) -> dict:
        nx, ny = transform_point(item['x'], item['y'], tx, ty, rot_deg)
        new_item = item.copy()
        new_item['x'], new_item['y'] = nx, ny
        if 'angle' in item:
            new_item['angle'] = (item['angle'] + rot_deg) % 360
        return new_item

    start_pose = apply_final_trans(start_pose_base)
    known_objects = [apply_final_trans(o) for o in known_objects_base]
    unknown_objects = [apply_final_trans(o) for o in unknown_objects_base]
    known_boxes = [apply_final_trans(b) for b in known_boxes_base]
    unknown_boxes = [apply_final_trans(b) for b in unknown_boxes_base]
    obstacles = [apply_final_trans(o) for o in obstacles_base]

    unused_objects_base = [o for o in OBJECTS if not any(is_same(o, ao) for ao in all_objects_base)]
    unused_boxes_base = [b for b in BOXES if not any(is_same(b, ab) for ab in all_boxes_base)]

    export_map_to_csv(folder, ws_poly, start_pose, known_objects, unknown_objects, known_boxes, unknown_boxes, obstacles,
                      ws_poly_base=Polygon(shifted_ws), start_pose_base=start_pose_base,
                      known_objects_base=known_objects_base, unknown_objects_base=unknown_objects_base,
                      known_boxes_base=known_boxes_base, unknown_boxes_base=unknown_boxes_base,
                      unused_objects_base=unused_objects_base, unused_boxes_base=unused_boxes_base,
                      obstacles_base=obstacles_base)

def main() -> None:
    """Main execution function for the task generator."""
    parser = argparse.ArgumentParser(description='DD2419 Task Generator: Randomly sample and transform a map.',
                                     formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('folder', help='Directory where map files will be saved')
    args = parser.parse_args()
    
    if os.path.exists(args.folder):
        choice = input(f"Folder '{args.folder}' already exists. Overwrite or Update? (o/u): ").lower().strip()
        if choice == 'u':
            required_files = ['workspace.csv', 'map.csv', 'map_complete.csv']
            missing = [f for f in required_files if not os.path.exists(os.path.join(args.folder, f))]
            if missing:
                print(f"Error: It is not possible to update a non-complete folder. Missing: {', '.join(missing)}")
                return
            update_existing_map(args.folder)
        else:
            # Overwrite
            generate_fresh_map(args.folder)
    else:
        os.makedirs(args.folder, exist_ok=True)
        generate_fresh_map(args.folder)

if __name__ == "__main__":
    main()
