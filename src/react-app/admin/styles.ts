/** One width for the admin area's action buttons (New, Save, Cancel, Delete…), so they line up. */
export const ACTION_BUTTON = "w-40";

/** Tabs that look like tabs: a rule across the page, the current one underlined over it. */
export const TAB_LIST = "group-data-[orientation=horizontal]/tabs:h-auto w-full justify-start gap-0 rounded-none border-b p-0";
export const TAB_TRIGGER =
	"h-auto flex-none rounded-none px-5 py-2.5 text-sm group-data-[orientation=horizontal]/tabs:after:bottom-[-1px] data-[state=active]:font-semibold";

/** The row-number column: 50px wide, whatever the content, shaded like the column headings, with a rule on its right. */
export const ORDINAL = "w-[50px] min-w-[50px] max-w-[50px] border-r border-border bg-(--admin-table-head) px-0 text-center";
