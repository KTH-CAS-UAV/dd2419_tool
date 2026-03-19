"""
DD2419 Map Evaluator

This script evaluates a solution map against a ground truth map by matching objects and boxes
based on their spatial proximity. It provides a detailed report on discovered, maintained,
and extra items, along with positional error statistics and a visualization of the results.
"""

import pandas as pd
import numpy as np
import argparse
import sys
import os
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, ConnectionPatch
from matplotlib.transforms import Affine2D
from scipy.optimize import linear_sum_assignment

def calculate_distance_matrix(df1: pd.DataFrame, df2: pd.DataFrame) -> np.ndarray:
    """Calculates the Euclidean distance between all pairs of points in two dataframes.

    Args:
        df1: First set of points (must contain 'x' and 'y' columns).
        df2: Second set of points (must contain 'x' and 'y' columns).

    Returns:
        A distance matrix of shape (len(df1), len(df2)).
    """
    n, m = len(df1), len(df2)
    dist_matrix = np.zeros((n, m))
    list1, list2 = df1.reset_index(), df2.reset_index()
    for i in range(n):
        for j in range(m):
            dist_matrix[i, j] = np.sqrt((list1.at[i, 'x'] - list2.at[j, 'x'])**2 + 
                                       (list1.at[i, 'y'] - list2.at[j, 'y'])**2)
    return dist_matrix

def match_items(df_truth: pd.DataFrame, df_sol: pd.DataFrame, threshold: float = 20.0) -> tuple[list[dict], int, int]:
    """Matches items between ground truth and solution maps using the Hungarian algorithm.

    Args:
        df_truth: Ground truth items.
        df_sol: Solution items.
        threshold: Maximum allowed distance for a match (cm).

    Returns:
        (matched_pairs, solution_count, truth_count)
            matched_pairs: List of dicts containing match information.
            solution_count: Number of items in the solution.
            truth_count: Number of items in the ground truth.
    """
    if len(df_truth) == 0:
        return [], len(df_sol), 0
    if len(df_sol) == 0:
        return [], 0, len(df_truth)
    dist_matrix = calculate_distance_matrix(df_truth, df_sol)
    cost_matrix = dist_matrix.copy()
    cost_matrix[cost_matrix > threshold] = threshold * 10
    row_ind, col_ind = linear_sum_assignment(cost_matrix)
    matched_pairs = []
    truth_indices = df_truth.index.tolist()
    sol_indices = df_sol.index.tolist()
    for r, c in zip(row_ind, col_ind):
        dist = dist_matrix[r, c]
        if dist < threshold:
            matched_pairs.append({
                'truth_idx': truth_indices[r],
                'sol_idx': sol_indices[c],
                'dist': dist,
                'truth_pos': (df_truth.at[truth_indices[r], 'x'], df_truth.at[truth_indices[r], 'y']),
                'sol_pos': (df_sol.at[sol_indices[c], 'x'], df_sol.at[sol_indices[c], 'y']),
                'type': df_truth.at[truth_indices[r], 'Type'],
                'is_known': df_truth.at[truth_indices[r], 'IsKnown']
            })
    return matched_pairs, len(df_sol), len(df_truth)

def identify_known_items(complete_df: pd.DataFrame, known_df: pd.DataFrame, threshold: float = 20.0) -> pd.Series:
    """Identifies which items in the complete ground truth were already provided as 'known'.

    Args:
        complete_df: The full ground truth map.
        known_df: The map containing only known items.
        threshold: Spatial matching threshold (cm).

    Returns:
        A boolean mask for complete_df indicating known items.
    """
    is_known = pd.Series(False, index=complete_df.index)
    for t_type in ['O', 'B']:
        truth_subset = complete_df[complete_df['Type'] == t_type]
        known_subset = known_df[known_df['Type'] == t_type]
        if len(truth_subset) > 0 and len(known_subset) > 0:
            dist_matrix = calculate_distance_matrix(truth_subset, known_subset)
            cost_matrix = dist_matrix.copy()
            cost_matrix[cost_matrix > threshold] = threshold * 10
            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            truth_indices = truth_subset.index.tolist()
            for r, c in zip(row_ind, col_ind):
                if dist_matrix[r, c] < threshold:
                    is_known[truth_indices[r]] = True
    return is_known

def plot_map_on_ax(ax: plt.Axes, df: pd.DataFrame, workspace_df: pd.DataFrame | None, title: str) -> None:
    """Plots a set of map items onto a provided matplotlib axis.

    Args:
        ax: The axis to plot on.
        df: Dataframe of map items.
        workspace_df: Dataframe of workspace boundary points.
        title: Title for the plot.
    """
    if workspace_df is not None:
        ax.plot(workspace_df['x'], workspace_df['y'], color='deepskyblue', alpha=0.5, linestyle='-', marker='.')
    obj_size = 10; box_w, box_h = 24, 16
    for _, row in df.iterrows():
        t = row['Type']; x, y = row['x'], row['y']
        is_known = row.get('IsKnown', False)
        if t == 'S':
            angle_rad = np.radians(row['angle'])
            u, v = np.cos(angle_rad), np.sin(angle_rad)
            ax.arrow(x, y, u * 20, v * 20, color='green', width=0.5, head_width=8, head_length=8, length_includes_head=True)
        elif t == 'O':
            if is_known:
                ax.add_patch(Rectangle((x - obj_size/2, y - obj_size/2), obj_size, obj_size, color='darkred', alpha=0.8))
            else:
                ax.add_patch(Rectangle((x - obj_size/2, y - obj_size/2), obj_size, obj_size, facecolor='none', edgecolor='darkred', linewidth=2, alpha=0.8))
        elif t == 'B':
            if is_known:
                rect = Rectangle((-box_w/2, -box_h/2), box_w, box_h, color='navy', alpha=0.6)
            else:
                rect = Rectangle((-box_w/2, -box_h/2), box_w, box_h, facecolor='none', edgecolor='navy', linewidth=2, alpha=0.6)
            rect.set_transform(Affine2D().rotate_deg(row.get('angle', 0)).translate(x, y) + ax.transData)
            ax.add_patch(rect)
        elif t == 'P':
            ax.scatter(x, y, color='black', marker='x', s=100, zorder=8)
    ax.set_aspect('equal')
    ax.set_title(title)
    ax.grid(True, linestyle='--', alpha=0.3)

def main():
    parser = argparse.ArgumentParser(description='DD2419 Map Evaluator',
                                     formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('folder', help='Directory where map.csv, map_complete.csv, map_solution.csv and workspace.csv are located')
    parser.add_argument('--threshold', type=float, default=20.0, help='Matching threshold (cm)')
    args = parser.parse_args()
    
    file_map = os.path.join(args.folder, "map.csv")
    file_complete = os.path.join(args.folder, "map_complete.csv")
    file_solution = os.path.join(args.folder, "map_solution.csv")
    file_workspace = os.path.join(args.folder, "workspace.csv")
    
    print(f"Evaluating task in folder `{args.folder}`")
    
    try:
        df_comp = pd.read_csv(file_complete)
        df_sol = pd.read_csv(file_solution)
        df_known = pd.read_csv(file_map)
        df_ws = pd.read_csv(file_workspace)
        df_ws = pd.concat([df_ws, df_ws.iloc[[0]]], ignore_index=True)
    except Exception as e:
        print(f"Error loading files: {e}"); sys.exit(1)

    is_known_in_truth = identify_known_items(df_comp, df_known, threshold=args.threshold)
    df_comp['IsKnown'] = is_known_in_truth

    obj_matches, obj_sol_count, obj_truth_total = match_items(df_comp[df_comp['Type'] == 'O'], df_sol[df_sol['Type'] == 'O'], threshold=args.threshold)
    box_matches, box_sol_count, box_truth_total = match_items(df_comp[df_comp['Type'] == 'B'], df_sol[df_sol['Type'] == 'B'], threshold=args.threshold)
    
    matches_all = obj_matches + box_matches
    matched_truth_indices = {m['truth_idx'] for m in matches_all}
    total_sol_count = obj_sol_count + box_sol_count
    
    known_truth_count = df_comp[df_comp['IsKnown']].shape[0]
    unknown_truth_count = df_comp[~df_comp['IsKnown'] & (df_comp['Type'].isin(['O', 'B']))].shape[0]
    known_matched = df_comp[df_comp['IsKnown'] & df_comp.index.isin(matched_truth_indices)].shape[0]
    unknown_matched = df_comp[~df_comp['IsKnown'] & (df_comp['Type'].isin(['O', 'B'])) & df_comp.index.isin(matched_truth_indices)].shape[0]
    penalties = total_sol_count - len(matches_all)

    print("\n" + "="*40 + "\n        DETAILED EVALUATION REPORT\n" + "="*40)
    print(f"MAINTAINED (Known Items): {known_matched}/{known_truth_count}")
    print(f"DISCOVERED (New Items):    {unknown_matched}/{unknown_truth_count}")
    print(f"PENALTIES (Extra Items):   {penalties}")
    if len(matches_all) > 0:
        dists = [m['dist'] for m in matches_all]
        print(f"POSITIONAL ERROR:         Avg={np.mean(dists):.2f}cm, Max={np.max(dists):.2f}cm")
    print("="*40)
    verdict = ""
    if known_matched == known_truth_count and unknown_matched == unknown_truth_count:
        verdict = "FINAL VERDICT: PERFECT SCORE!" if penalties == 0 else "FINAL VERDICT: ALL ITEMS DISCOVERED (with penalties)"
    else:
        verdict = f"FINAL VERDICT: INCOMPLETE ({known_truth_count-known_matched} missed known, {unknown_truth_count-unknown_matched} missed unknown)"
    print(verdict); print("="*40)

    fig, (ax_l, ax_r) = plt.subplots(1, 2, figsize=(20, 15))
    plot_map_on_ax(ax_l, df_comp[df_comp['Type'].isin(['S', 'O', 'B', 'P'])], df_ws, "Ground Truth")
    plot_map_on_ax(ax_r, df_sol, df_ws, "Solution")
    
    cmap = plt.get_cmap('tab20')
    legend_elements = [
        plt.Line2D([0], [0], color='deepskyblue', alpha=0.5, label='Workspace'),
        plt.Line2D([0], [0], color='green', marker='$\u279E$', linestyle='None', markersize=10, label='Start Pose'),
        plt.Line2D([0], [0], color='darkred', marker='s', linestyle='None', alpha=0.8, label='Known Object'),
        plt.Line2D([0], [0], color='darkred', marker='s', linestyle='None', markerfacecolor='none', markersize=10, markeredgewidth=2, label='Unknown Object'),
        Rectangle((0, 0), 1.5, 1, color='navy', alpha=0.6, label='Known Box'),
        Rectangle((0, 0), 1.5, 1, facecolor='none', edgecolor='navy', linewidth=2, alpha=0.6, label='Unknown Box'),
        plt.Line2D([0], [0], color='black', marker='x', linestyle='None', markersize=10, label='Obstacle'),
        plt.Line2D([0], [0], color='green', linestyle='-', linewidth=2, label='Known Match'),
        plt.Line2D([0], [0], color='gray', linestyle='--', linewidth=1.5, label='Unknown Match')
    ]

    for i, m in enumerate(matches_all):
        if m['is_known']:
            color = 'green'; linestyle = '-'; linewidth = 2.0; alpha = 0.8
        else:
            color = cmap(i % 20); linestyle = '--'; linewidth = 1.5; alpha = 0.6
        cp = ConnectionPatch(xyA=m['truth_pos'], xyB=m['sol_pos'], coordsA="data", coordsB="data", axesA=ax_l, axesB=ax_r, color=color, linestyle=linestyle, alpha=alpha, linewidth=linewidth, zorder=10)
        fig.add_artist(cp)
        ax_l.plot(*m['truth_pos'], 'o', color=color, markersize=5, alpha=0.8)
        ax_r.plot(*m['sol_pos'], 'o', color=color, markersize=5, alpha=0.8)

    plt.tight_layout(rect=[0, 0, 1, 0.75])
    
    pos_l = ax_l.get_position()
    fig.legend(handles=legend_elements, loc='lower center', bbox_to_anchor=(pos_l.x0 + pos_l.width/2, pos_l.y1 + 0.05), ncol=2, fontsize=10, title="Legend", title_fontsize=12)
    
    pos_r = ax_r.get_position()
    stats_text = (f"EVALUATION SUMMARY\n\nMaintained (Known): {known_matched}/{known_truth_count}\nDiscovered (New):  {unknown_matched}/{unknown_truth_count}\nPenalties (Extra): {penalties}\n\n{verdict}")
    fig.text(pos_r.x0 + pos_r.width/2, pos_r.y1 + 0.05, stats_text, ha='center', va='bottom', fontsize=12, family='monospace', bbox=dict(facecolor='white', alpha=0.9, edgecolor='gray', boxstyle='round,pad=0.5'))
    
    output_file = os.path.join(args.folder, "evaluation.png")
    plt.savefig(output_file)
    print(f"Visualization saved to {output_file}")

if __name__ == "__main__":
    main()
