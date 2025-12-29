import instaloader
from loguru import logger as log
import json
import argparse
from pathlib import Path

class InstagramScraper:
    def __init__(self):
        self.loader = instaloader.Instaloader(
            download_pictures=False,
            download_videos=False,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    
    def scrape_posts(self, username: str, limit: int = None):
        """Scrape posts from a specific user profile"""
        log.info(f"Starting to scrape posts for user: {username}")
        try:
            profile = instaloader.Profile.from_username(self.loader.context, username)
        except Exception as e:
            log.error(f"Error fetching profile '{username}': {e}")
            return []

        posts_data = []
        count = 0
        
        # Iterate through profile posts
        for post in profile.get_posts():
            if limit and count >= limit:
                break
            
            log.debug(f"Parsing post {post.shortcode}")
            post_info = {
                "shortcode": post.shortcode,
                "timestamp": post.date_utc.isoformat(),
                "caption": post.caption,
                "likes": post.likes,
                "comments": post.comments,
                "is_video": post.is_video,
                "url": f"https://www.instagram.com/p/{post.shortcode}/",
                "display_url": post.url,
                "video_url": post.video_url if post.is_video else None,
                "location": str(post.location) if post.location else None,
                "typename": post.typename
            }
            posts_data.append(post_info)
            count += 1
            
            if count % 5 == 0:
                log.info(f"Scraped {count} posts...")

        log.success(f"Successfully scraped {len(posts_data)} posts for {username}")
        return posts_data

    def save_results(self, data, username):
        """Save results to a JSON file"""
        output_dir = Path("results")
        output_dir.mkdir(exist_ok=True)
        
        file_path = output_dir / f"{username}_posts.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        log.info(f"Results saved to {file_path}")

def main():
    parser = argparse.ArgumentParser(description="Instagram Scraper using Instaloader")
    parser.add_argument("username", help="Instagram username to scrape")
    parser.add_argument("--limit", type=int, default=10, help="Number of posts to fetch (default: 10, use 0 for all)")
    
    parser.add_argument("--login_user", help="Instagram username for login")
    parser.add_argument("--login_pass", help="Instagram password for login")
    
    args = parser.parse_args()
    
    scraper = InstagramScraper()
    
    if args.login_user and args.login_pass:
        try:
            log.info(f"Logging in as {args.login_user}...")
            scraper.loader.login(args.login_user, args.login_pass)
            log.success("Login successful!")
        except Exception as e:
            log.error(f"Login failed: {e}")
            # Decide if we should continue or exit. Often better to exit if login was requested but failed.
            # But maybe we fallback to anonymous? Let's fallback but warn.
            log.warning("Falling back to anonymous scraping (which may fail)...")
    
    limit = args.limit if args.limit > 0 else None
    posts = scraper.scrape_posts(args.username, limit=limit)
    
    if posts:
        scraper.save_results(posts, args.username)
    else:
        log.warning("No posts found or error occurred.")

if __name__ == "__main__":
    main()
